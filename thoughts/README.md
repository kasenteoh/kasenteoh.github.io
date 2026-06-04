# thoughts/

Standalone story pages for the **thoughts** section. Each story is its own
static HTML page with its own shareable URL and social-share preview tags.

## Add a new story

1. **Create the page** — copy `_template.html` to `thoughts/<your-slug>.html`
   (e.g. `returning-to-nvidia.html`). The slug becomes the URL:
   `https://kasenteoh.github.io/thoughts/<your-slug>.html`.

2. **Fill it in** — replace every `{{PLACEHOLDER}}`:
   - `{{LANG}}` → `zh-Hans` (Chinese) or `en` (English)
   - `{{TITLE}}`, `{{DEK}}` (one-line subtitle), `{{DATE}}` (`YYYY-MM-DD`)
   - `{{DESCRIPTION}}` → short text used for search + link previews
   - Write the story as `<p>...</p>` paragraphs inside `.post-body`.
   - The `.post-coda` block at the end is optional (the quiet aside +
     emphasized closing line). Delete it if you don't want it.

3. **Add a preview card** to `index.html`, inside the `#thoughts` section's
   `<ul class="post-list">`. Newest first:

   ```html
   <li>
     <a class="post-card" href="thoughts/<your-slug>.html">
       <div class="post-head">
         <span class="post-glyph" aria-hidden="true">&#9654;</span>
         <h3>Your Title</h3>
         <time class="post-date" datetime="YYYY-MM-DD">YYYY-MM-DD</time>
       </div>
       <p class="post-desc">One-line teaser.</p>
       <span class="post-readmore">read &rarr;</span>
     </a>
   </li>
   ```

4. **Register it** in `sitemap.xml` (copy an existing `<url>` block, swap the
   `<loc>` and `<lastmod>`).

That's it — no build step. `_template.html` is not linked anywhere and is safe
to leave in place.
