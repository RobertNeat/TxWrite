-- Export-only safety filter (UI overhaul: "export formats beyond PDF").
-- Without this, pandoc's own resource-embedding (--embed-resources, used for
-- HTML export) will follow an Image src wherever it points: a remote URL
-- triggers an outbound fetch (SSRF, and architecture.md requires download
-- sources to be allowlisted), and an absolute or ".."-containing local path
-- reads and embeds arbitrary files from the host filesystem as base64 (e.g.
-- ![x](/etc/passwd) ends up inlined in the exported HTML) — a real risk once
-- project content can come from an imported zip. Any Image whose src is not a
-- plain path confined to the project directory is replaced with its alt text.
function Image(img)
  local src = img.src
  if src:match("^%a[%w+.-]*://") or src:match("^/") or src:match("%.%.") then
    return pandoc.Span(img.caption)
  end
  return img
end
