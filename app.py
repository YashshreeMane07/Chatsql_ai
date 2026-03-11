import os
import json
import re
import time
from flask import Flask, request, jsonify, render_template, session
from flask_cors import CORS
import sqlalchemy
from sqlalchemy import create_engine, text, inspect
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "chatsql-secret-2024")
CORS(app)

# ── GROQ CLIENT ──────────────────────────────────────
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY", ""))

# ── DB ENGINE (lazy init) ─────────────────────────────
_engine = None

def get_engine():
    global _engine
    if _engine is None:
        db_url = os.getenv("DATABASE_URL", "")
        if not db_url:
            return None
        try:
            _engine = create_engine(db_url, pool_pre_ping=True, connect_args={"connect_timeout": 10})
            # Test connection
            with _engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception as e:
            _engine = None
            raise e
    return _engine


# ── SCHEMA INTROSPECTION ──────────────────────────────
def get_schema_text():
    """Return a compact schema string for the LLM prompt."""
    engine = get_engine()
    if not engine:
        return "No database connected."
    try:
        inspector = inspect(engine)
        lines = []
        for table in inspector.get_table_names():
            cols = inspector.get_columns(table)
            col_defs = ", ".join(f"{c['name']} {str(c['type'])}" for c in cols)
            lines.append(f"Table {table}({col_defs})")
        return "\n".join(lines)
    except Exception as e:
        return f"Schema unavailable: {e}"


def get_schema_json():
    """Return schema as JSON for the frontend schema panel."""
    engine = get_engine()
    if not engine:
        return {}
    try:
        inspector = inspect(engine)
        schema = {}
        for table in inspector.get_table_names():
            cols = inspector.get_columns(table)
            fks  = inspector.get_foreign_keys(table)
            pk   = inspector.get_pk_constraint(table).get("constrained_columns", [])
            schema[table] = {
                "columns": [
                    {
                        "name": c["name"],
                        "type": str(c["type"]),
                        "nullable": c.get("nullable", True),
                        "primary_key": c["name"] in pk
                    }
                    for c in cols
                ],
                "foreign_keys": fks
            }
        return schema
    except Exception as e:
        return {"error": str(e)}


# ── SQL EXTRACTION ────────────────────────────────────
def extract_sql(text_content):
    """Pull SQL from markdown code blocks or raw text."""
    # Try ```sql ... ``` block
    m = re.search(r"```(?:sql)?\s*([\s\S]+?)```", text_content, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    # Try lines starting with SELECT/INSERT/UPDATE/DELETE/WITH
    lines = text_content.strip().split("\n")
    sql_lines = []
    in_sql = False
    for line in lines:
        if re.match(r"^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|DROP|ALTER|SHOW)\b", line, re.IGNORECASE):
            in_sql = True
        if in_sql:
            sql_lines.append(line)
    return "\n".join(sql_lines).strip() if sql_lines else ""


# ── LLM: SQL GENERATION ───────────────────────────────
def generate_sql(question: str, schema: str, conversation_history: list) -> dict:
    system_prompt = f"""You are an expert SQL assistant. Your job is to convert natural language questions into accurate SQL queries.

DATABASE SCHEMA:
{schema}

RULES:
1. Generate ONLY valid SQL for the given schema.
2. Always wrap SQL in ```sql ... ``` code blocks.
3. After the SQL block, write a brief plain-English explanation (2-3 sentences).
4. If the question is ambiguous, make a reasonable assumption and mention it.
5. Never make up table or column names — only use what's in the schema above.
6. For SELECT queries, add a LIMIT 500 unless the user asks for all rows.
7. If you cannot generate SQL (e.g., question is unrelated to the database), say so clearly — do NOT generate a query.
8. Be aware of the conversation context — the user may be referring to previous results.

Output format:
```sql
YOUR SQL HERE
```
Brief explanation of what the query does."""

    messages = [{"role": "system", "content": system_prompt}]
    # Add conversation history (last 8 turns for context)
    for turn in conversation_history[-8:]:
        messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({"role": "user", "content": question})

    try:
        response = groq_client.chat.completions.create(
            model=os.getenv("GROQ_MODEL", "llama3-70b-8192"),
            messages=messages,
            temperature=0.1,
            max_tokens=1500,
        )
        full_response = response.choices[0].message.content
        sql = extract_sql(full_response)
        # Explanation = text after the SQL block
        explanation = re.sub(r"```(?:sql)?[\s\S]+?```", "", full_response).strip()
        return {
            "sql": sql,
            "explanation": explanation,
            "raw": full_response,
            "tokens_used": response.usage.total_tokens
        }
    except Exception as e:
        return {"error": str(e), "sql": "", "explanation": ""}


# ── LLM: EXPLAIN QUERY ────────────────────────────────
def explain_query(sql: str, schema: str) -> str:
    prompt = f"""Explain this SQL query in simple terms that a non-technical user can understand.
Be concise (3-5 sentences). Mention what tables are used and what the result represents.

Schema context:
{schema}

SQL:
{sql}"""
    try:
        response = groq_client.chat.completions.create(
            model=os.getenv("GROQ_MODEL", "llama3-70b-8192"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=400,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"Could not generate explanation: {e}"


# ── LLM: SUGGEST FIX ─────────────────────────────────
def suggest_fix(sql: str, error: str, schema: str) -> str:
    prompt = f"""This SQL query failed with an error. Suggest a corrected query.

Schema:
{schema}

Failed SQL:
{sql}

Error:
{error}

Provide the corrected SQL in a ```sql ... ``` block and briefly explain the fix."""
    try:
        response = groq_client.chat.completions.create(
            model=os.getenv("GROQ_MODEL", "llama3-70b-8192"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=600,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"Could not generate fix: {e}"


# ── EXECUTE SQL ───────────────────────────────────────
def execute_sql(sql: str) -> dict:
    engine = get_engine()
    if not engine:
        return {"error": "No database connected", "type": "error"}

    start = time.time()
    try:
        with engine.connect() as conn:
            result = conn.execute(text(sql))
            elapsed = round((time.time() - start) * 1000, 1)

            # DML / DDL
            if result.returns_rows is False:
                conn.commit()
                return {
                    "type": "dml",
                    "rowcount": result.rowcount,
                    "elapsed_ms": elapsed
                }

            # SELECT
            keys = list(result.keys())
            rows = [dict(zip(keys, row)) for row in result.fetchall()]

            # Convert non-serialisable types
            for row in rows:
                for k, v in row.items():
                    if hasattr(v, "isoformat"):
                        row[k] = v.isoformat()
                    elif v is None:
                        row[k] = None
                    else:
                        row[k] = str(v) if not isinstance(v, (int, float, bool, str)) else v

            return {
                "type": "select",
                "columns": keys,
                "rows": rows,
                "row_count": len(rows),
                "elapsed_ms": elapsed
            }
    except Exception as e:
        elapsed = round((time.time() - start) * 1000, 1)
        return {
            "type": "error",
            "error": str(e),
            "elapsed_ms": elapsed
        }


# ══════════════════════════════════════════════════════
#  ROUTES
# ══════════════════════════════════════════════════════

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status", methods=["GET"])
def api_status():
    """Check DB + Groq connectivity."""
    db_ok = False
    db_info = {}
    try:
        engine = get_engine()
        if engine:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            db_ok = True
            db_info = {"url": str(engine.url).split("@")[-1]}  # hide credentials
    except Exception as e:
        db_info = {"error": str(e)}

    groq_ok = bool(os.getenv("GROQ_API_KEY"))

    return jsonify({
        "database": {"connected": db_ok, **db_info},
        "groq": {"configured": groq_ok, "model": os.getenv("GROQ_MODEL", "llama3-70b-8192")},
    })


@app.route("/api/schema", methods=["GET"])
def api_schema():
    return jsonify(get_schema_json())


@app.route("/api/ask", methods=["POST"])
def api_ask():
    """Main endpoint: NL question → SQL → execute → return everything."""
    data = request.get_json(force=True)
    question    = data.get("question", "").strip()
    history     = data.get("history", [])      # [{role, content}, ...]

    if not question:
        return jsonify({"error": "Question is required"}), 400

    schema = get_schema_text()

    # 1. Generate SQL via Groq
    llm_result = generate_sql(question, schema, history)
    if "error" in llm_result and not llm_result.get("sql"):
        return jsonify({"error": llm_result["error"]}), 500

    sql        = llm_result.get("sql", "")
    explanation = llm_result.get("explanation", "")
    tokens_used = llm_result.get("tokens_used", 0)

    # 2. Execute SQL
    db_result = {}
    fix_suggestion = None
    if sql:
        db_result = execute_sql(sql)
        # If error, ask Groq for a fix
        if db_result.get("type") == "error":
            fix_suggestion = suggest_fix(sql, db_result["error"], schema)

    return jsonify({
        "question":       question,
        "generated_sql":  sql,
        "explanation":    explanation,
        "db_result":      db_result,
        "fix_suggestion": fix_suggestion,
        "tokens_used":    tokens_used,
        "raw_llm":        llm_result.get("raw", ""),
    })


@app.route("/api/explain", methods=["POST"])
def api_explain():
    data = request.get_json(force=True)
    sql  = data.get("sql", "").strip()
    if not sql:
        return jsonify({"error": "SQL required"}), 400
    schema = get_schema_text()
    explanation = explain_query(sql, schema)
    return jsonify({"explanation": explanation})


@app.route("/api/run_sql", methods=["POST"])
def api_run_sql():
    """Execute raw SQL (for Edit & Re-run feature)."""
    data = request.get_json(force=True)
    sql  = data.get("sql", "").strip()
    if not sql:
        return jsonify({"error": "SQL required"}), 400
    result = execute_sql(sql)
    return jsonify(result)


@app.route("/api/connect", methods=["POST"])
def api_connect():
    """Connect to a new database at runtime."""
    global _engine
    data    = request.get_json(force=True)
    db_url  = data.get("database_url", "").strip()
    if not db_url:
        return jsonify({"error": "database_url required"}), 400
    try:
        _engine = None
        os.environ["DATABASE_URL"] = db_url
        engine = get_engine()
        if engine is None:
            return jsonify({"error": "Could not create engine"}), 500
        schema = get_schema_json()
        return jsonify({"connected": True, "tables": list(schema.keys())})
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)}), 400


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
