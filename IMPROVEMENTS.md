# Future Improvements

## Nova — Slack Partner Triage
- [ ] **Real online research via search API** — integrate Brave Search or Serper (Google) so Nova can actually visit the partner's website, read recent news, and check their LinkedIn before generating questions, rather than relying on Claude's training data
- [ ] **Slack signing secret verification** — enforce `SLACK_SIGNING_SECRET` so the `/api/slack/events` webhook rejects spoofed requests (currently optional)
- [ ] **Edit/re-triage** — allow a rep to tag `@Nova` in a thread to re-run the decision after providing more context
- [ ] **Persistent announcement storage** — replace the Slack message scan with a proper database (e.g. Vercel KV / Upstash) so approved announcements survive channel history limits

## Mission Control Dashboard
- [ ] **Calendar item actions** — add approve / reject / reschedule buttons on calendar entries so Gloria can action items without leaving the dashboard
- [ ] **Real-time updates** — use Server-Sent Events or polling so the calendar refreshes automatically when Nova approves a new announcement in Slack
- [ ] **Announcement detail view** — clicking a calendar item shows the full Slack thread context (original post + Nova's questions + rep's answers)

## Other Bots
- [ ] **Content Writer** — implement LLM-powered draft generation using a `ContentBrief` from Nova
- [ ] **HubSpot Publisher** — wire up HubSpot CMS API to publish approved drafts
- [ ] **Performance Analyst** — pull HubSpot / Google Analytics data and surface top/bottom performers back into the calendar
