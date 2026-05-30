import io
import json
import os
import sys
from pathlib import Path
from statistics import median
from typing import List, Optional, Any

import pdfplumber
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
if ENV_PATH.exists():
    load_dotenv(ENV_PATH)
else:
    load_dotenv()

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "3001"))
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

app = FastAPI(title="PDF Table Parser", version="1.0.0", description="Parse tables from PDF via pdfplumber.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS if ALLOWED_ORIGINS else ["*"],
    allow_credentials=True,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)


class ParsedTable(BaseModel):
    rows: List[List[Optional[str]]]


class ParsedPage(BaseModel):
    page_number: int
    tables: List[ParsedTable]


class ParseResult(BaseModel):
    file_name: str
    grid: List[List[str]]
    pages: List[ParsedPage]


def clean_cell(val: Any) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    if s == "":
        return None
    return " ".join(s.split())


def clean_rows(table: List[List[Any]]) -> List[List[Optional[str]]]:
    cleaned: List[List[Optional[str]]] = []
    for row in table or []:
        row_clean = [clean_cell(c) for c in (row or [])]
        if any(cell is not None for cell in row_clean):
            cleaned.append(row_clean)
    return cleaned


def rows_to_grid(rows: List[List[Optional[str]]]) -> List[List[str]]:
    out: List[List[str]] = []
    for row in rows or []:
        out.append([(c if c is not None else "") for c in (row or [])])
    return out


def score_rows(rows: List[List[Optional[str]]]) -> tuple[int, int, int]:
    if not rows:
        return (0, 0, 0)
    non_empty = 0
    max_cols = 0
    for r in rows:
        if r and len(r) > max_cols:
            max_cols = len(r)
        for c in r or []:
            if c is not None and str(c).strip():
                non_empty += 1
    return (non_empty, len(rows), max_cols)


def parse_pdf_content(content: bytes, file_name: str) -> ParseResult:
    bio = io.BytesIO(content)
    pages_out: List[ParsedPage] = []
    best_rows: List[List[Optional[str]]] = []
    best_score = (0, 0, 0)

    with pdfplumber.open(bio) as pdf:
        page_count = len(pdf.pages)
        for idx, page in enumerate(pdf.pages, start=1):
            page_tables: List[ParsedTable] = []

            single = page.extract_table()
            if single:
                rows = clean_rows(single)
                page_tables.append(ParsedTable(rows=rows))
                sc = score_rows(rows)
                if sc > best_score:
                    best_score = sc
                    best_rows = rows

            multi = page.extract_tables() or []
            for t in multi:
                if not t:
                    continue
                rows = clean_rows(t)
                if not rows:
                    continue
                page_tables.append(ParsedTable(rows=rows))
                sc = score_rows(rows)
                if sc > best_score:
                    best_score = sc
                    best_rows = rows

            pages_out.append(ParsedPage(page_number=idx, tables=page_tables))

    if best_rows:
        return ParseResult(file_name=file_name, grid=rows_to_grid(best_rows), pages=pages_out)

    return ParseResult(file_name=file_name, grid=[], pages=pages_out)


@app.post("/api/parse-pdf", response_model=ParseResult)
async def parse_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="请上传 PDF 文件")
    try:
        content = await file.read()
        return parse_pdf_content(content, file.filename)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析失败: {str(e)}")


def cli_main(argv: List[str]) -> int:
    if len(argv) < 3 or argv[1] != "--cli":
        return 2
    file_path = argv[2]
    ext = os.path.splitext(file_path)[1].lower()
    try:
        import contextlib

        with open(file_path, "rb") as f:
            content = f.read()

        with contextlib.redirect_stdout(sys.stderr):
            if ext in [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"]:
                raise ValueError("image_not_supported")
            out = parse_pdf_content(content, os.path.basename(file_path))

        payload = out.model_dump() if hasattr(out, "model_dump") else out.dict()
        raw = json.dumps(payload, ensure_ascii=False)
        sys.stdout.buffer.write(raw.encode("utf-8"))
        sys.stdout.flush()
        return 0
    except Exception:
        import traceback

        sys.stderr.write(traceback.format_exc())
        sys.stderr.flush()
        return 1


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--cli":
        raise SystemExit(cli_main(sys.argv))
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
