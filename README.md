# HR Agent

An AI assistant for everyday HR work, powered by Claude.

- **Screen CVs**: upload CVs (PDF, Word or text) and a job description. You get a ranked shortlist with a score, evidence for each requirement, gaps, and tailored interview questions. Export it to CSV, or draft an interview invitation or rejection letter in one click.
- **Ask HR**: answers employee questions about leave, benefits, payroll and procedures from your own policy documents, and names the policy it used. When the policies don't cover a question, it says so and points the employee to HR.
- **Draft letters**: offer, appointment, interview invitation, rejection, probation confirmation, promotion, increment, experience certificate, relieving, resignation acceptance, warning, termination, or any custom letter. Edit the draft, ask for revisions, then copy it, download it as a Word file, or print it to PDF.
- **Policies**: add your handbook and policies (PDF, Word, text, or pasted).

## How it works

It's a static website: plain HTML, CSS and JavaScript, with no server and no build step. It runs in your browser and calls the [Anthropic API](https://docs.claude.com) directly with **your own API key**.

- Your API key, settings, policies and chat history are saved in your browser (`localStorage`) and nowhere else.
- CVs, questions and letter details go only to Anthropic's API, and only when you run a task.
- Nothing is stored in this repository or on GitHub.

Because the key sits in the browser, use the app on your own computer only, not a shared one. Anyone who has your browser profile could read the key.

## Getting started

1. Create an API key at [console.anthropic.com](https://console.anthropic.com/settings/keys).
2. Open the app, go to **Settings**, paste the key, add your company details, and click **Test connection**.
3. Add your HR policies under **Policies**.

### Run it locally

Any static file server works, for example:

```bash
npx http-server . -p 8123
```

Then open http://localhost:8123. Opening `index.html` directly from disk won't work, because browsers block JavaScript modules on `file://` pages.

### Host it on GitHub Pages

Settings → Pages → Deploy from a branch → `main` / root. The site will be at `https://<username>.github.io/Hr-Agent/`.

## Models

Choose the model in Settings:

- **Claude Opus 5.5** (default): best quality.
- **Claude Sonnet 5.5**: faster and cheaper.

## Responsible use

- CV screening is decision support. The AI is told to ignore protected characteristics (name, age, gender, nationality, religion, family status, photos and so on) and judge only job-relevant evidence. A person should review every shortlist and make the hiring decision.
- Check warning and termination letters against your policies and local labour law before you send them.
- Only process personal data in ways your privacy policy and local data-protection law allow.

## Project structure

```
index.html      App layout
styles.css      Styles (light and dark mode)
js/app.js       UI and features
js/ai.js        Claude API calls (Anthropic SDK, streaming)
js/prompts.js   System prompts, letter types, CV scoring schema
js/files.js     PDF / Word / text file reading
js/store.js     Browser storage
```
