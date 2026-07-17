# The Wardrobe — deploy from your phone

A wardrobe app: upload photos, AI catalogues each garment, get outfit suggestions.
Your Anthropic API key stays private in a serverless function (`api/claude.js`).
No login/database — each person's wardrobe saves in their own browser.

## What you need
- A GitHub account (free)
- A Vercel account (free — sign in with GitHub)
- An Anthropic API key from console.anthropic.com (needs a little billing credit)

## Deploy — all from a phone browser

### 1. Put the code on GitHub
- Unzip this folder on your phone (Files app can do this).
- Go to github.com → New repository → name it `my-wardrobe` → Create.
- On the empty repo page, tap "uploading an existing file".
- Upload ALL files, keeping the folders (`api/`, `src/`) intact.
  Tip: on mobile it's easiest to upload folder by folder if it won't take them all at once.
- Commit the files.

### 2. Deploy on Vercel
- Go to vercel.com → sign in with GitHub.
- Add New → Project → pick your `my-wardrobe` repo → Import.
- Framework should auto-detect as "Vite". Leave build settings as-is.
- BEFORE clicking Deploy, open "Environment Variables" and add:
    Name:  ANTHROPIC_API_KEY
    Value: (paste your sk-ant-... key)
- Click Deploy. Wait ~1 minute.

### 3. Share
- Vercel gives you a link like `my-wardrobe.vercel.app`.
- Send it to friends. Anyone can open it in a browser and tap
  "Add to Home Screen" to use it like an app.

## Costs
Each photo analysis costs a fraction of a cent. Watch usage at console.anthropic.com.
Anyone with your link uses your API credit, so share it with people you trust,
or set a spend limit in the Anthropic console.

## Later (needs a computer, easier)
- Accounts + shared/saved wardrobes (Supabase)
- Per-garment image cropping (segmentation)
- Saving favorite outfits
