-- Rewrites .svg image references to .pdf, since the backend pre-converts every
-- project SVG to a PDF of the same name before the LaTeX compile runs
-- (architecture.md section 8). Without this, pandoc emits \includesvg{...} for
-- .svg paths, which needs the svg package (and Inkscape via shell-escape) rather
-- than a plain \includegraphics{...}.
function Image(img)
  img.src = img.src:gsub("%.svg$", ".pdf")
  return img
end
