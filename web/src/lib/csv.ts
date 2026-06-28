/**
 * Minimal RFC-4180-ish CSV parser. Handles quoted fields, escaped quotes
 * (""), and commas / newlines inside quotes. Returns an array of row objects
 * keyed by the header row. No dependency — the scraper output is well-formed.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text.trim())
  if (rows.length === 0) return []

  const headers = rows[0]
  return rows.slice(1).map((cells) => {
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? ''
    })
    return row
  })
}

function parseRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }

    if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      // swallow \r\n as a single break
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }

  // trailing field / row (no final newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}
