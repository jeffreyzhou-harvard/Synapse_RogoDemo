# Slack Integration Setup Guide

## Quick Start (5 minutes)

### Step 1: Create Slack App

1. Go to https://api.slack.com/apps
2. Click **"Create New App"** → **"From scratch"**
3. Name: `MidLayer`
4. Pick your workspace
5. Click **"Create App"**

---

### Step 2: Configure OAuth & Permissions

1. In sidebar, click **"OAuth & Permissions"**
2. Scroll to **"Scopes"** → **"Bot Token Scopes"**
3. Add these scopes:
   ```
   chat:write
   chat:write.public
   commands
   users:read
   channels:read
   im:write
   app_mentions:read
   ```
4. Scroll up and click **"Install to Workspace"**
5. Copy the **"Bot User OAuth Token"** (starts with `xoxb-`)
6. Add to your `.env`:
   ```bash
   SLACK_BOT_TOKEN=xoxb-your-token-here
   ```

---

### Step 3: Enable Event Subscriptions

1. In sidebar, click **"Event Subscriptions"**
2. Toggle **"Enable Events"** to ON
3. Request URL: `https://your-domain.com/slack/events`
   - For local dev, use ngrok: `https://abc123.ngrok.io/slack/events`
4. Under **"Subscribe to bot events"**, add:
   ```
   app_mention
   message.channels
   ```
5. Click **"Save Changes"**

---

### Step 4: Enable Interactivity

1. In sidebar, click **"Interactivity & Shortcuts"**
2. Toggle **"Interactivity"** to ON
3. Request URL: `https://your-domain.com/slack/interactions`
4. Click **"Save Changes"**

---

### Step 5: Create Slash Commands

1. In sidebar, click **"Slash Commands"**
2. Click **"Create New Command"**
3. Create `/midlayer` command:
   - Command: `/midlayer`
   - Request URL: `https://your-domain.com/slack/commands`
   - Short Description: `MidLayer AI assistant for specs and code`
   - Usage Hint: `status [task-id] | spec [title] | graph | help`
4. Click **"Save"**

---

### Step 6: Get Signing Secret

1. In sidebar, click **"Basic Information"**
2. Scroll to **"App Credentials"**
3. Copy **"Signing Secret"**
4. Add to your `.env`:
   ```bash
   SLACK_SIGNING_SECRET=your-secret-here
   ```

---

### Step 7: Add Routes to FastAPI

Add to `app/main.py`:

```python
from app.slack_endpoints import slack_events, slack_interactions, slack_commands

# Add Slack routes
app.add_api_route("/slack/events", slack_events, methods=["POST"])
app.add_api_route("/slack/interactions", slack_interactions, methods=["POST"])
app.add_api_route("/slack/commands", slack_commands, methods=["POST"])
```

---

### Step 8: Test with ngrok (Local Development)

1. Install ngrok: `brew install ngrok` (Mac) or download from https://ngrok.com
2. Start your FastAPI server: `uvicorn app.main:app --reload --port 8000`
3. In another terminal: `ngrok http 8000`
4. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)
5. Update Slack app URLs:
   - Event Subscriptions: `https://abc123.ngrok.io/slack/events`
   - Interactivity: `https://abc123.ngrok.io/slack/interactions`
   - Slash Commands: `https://abc123.ngrok.io/slack/commands`

---

### Step 9: Test in Slack

1. Go to your Slack workspace
2. Invite bot to a channel: `/invite @MidLayer`
3. Try commands:
   ```
   /midlayer help
   /midlayer status API-1
   /midlayer graph
   ```
4. Test mentions:
   ```
   @MidLayer please review payment spec
   ```

---

## Environment Variables

Complete `.env` configuration:

```bash
# Slack Integration
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here

# Optional: Slack App Credentials (for OAuth flow)
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret

# Your app URL (for generating links)
APP_BASE_URL=https://app.midlayer.dev

# Existing config
ANTHROPIC_API_KEY=...
GITHUB_TOKEN=...
GITHUB_OWNER=...
GITHUB_REPO=...
```

---

## Testing Checklist

### Basic Functionality
- [ ] Bot responds to `/midlayer help`
- [ ] Bot responds to `/midlayer status [task-id]`
- [ ] Bot responds to `/midlayer graph`
- [ ] Bot responds to @mentions

### Interactive Components
- [ ] Spec approval button works
- [ ] PR notification appears after approval
- [ ] Progress updates show in real-time
- [ ] Knowledge graph notification appears

### Error Handling
- [ ] Invalid commands show helpful error
- [ ] Missing permissions show clear message
- [ ] API failures show friendly error

---

## Production Deployment

### Option 1: Deploy to Heroku

```bash
# Install Heroku CLI
brew tap heroku/brew && brew install heroku

# Login and create app
heroku login
heroku create midlayer-api

# Set environment variables
heroku config:set SLACK_BOT_TOKEN=xoxb-...
heroku config:set SLACK_SIGNING_SECRET=...
heroku config:set ANTHROPIC_API_KEY=...
heroku config:set GITHUB_TOKEN=...

# Deploy
git push heroku main

# Update Slack app URLs to:
# https://midlayer-api.herokuapp.com/slack/events
# https://midlayer-api.herokuapp.com/slack/interactions
# https://midlayer-api.herokuapp.com/slack/commands
```

### Option 2: Deploy to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and initialize
railway login
railway init

# Set environment variables in Railway dashboard
# Deploy
railway up

# Update Slack app URLs to your Railway domain
```

### Option 3: Deploy to Render

1. Connect GitHub repo to Render
2. Create new Web Service
3. Set environment variables in Render dashboard
4. Deploy
5. Update Slack app URLs to your Render domain

---

## Advanced Features

### Scheduled Digests

Add to `app/main.py`:

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.slack_endpoints import send_daily_digest

scheduler = AsyncIOScheduler()

@app.on_event("startup")
async def start_scheduler():
    # Send daily digest at 9am
    scheduler.add_job(
        send_daily_digest,
        'cron',
        hour=9,
        minute=0,
        args=['C123456']  # Your channel ID
    )
    scheduler.start()
```

### User Preferences

Store user preferences in database:

```python
class UserPreferences(BaseModel):
    user_id: str
    notify_on_pr: bool = True
    notify_on_spec_review: bool = True
    notify_on_task_unblock: bool = True
    daily_digest: bool = True
    digest_time: str = "09:00"
```

### Multi-Workspace Support

For SaaS, support multiple Slack workspaces:

```python
class SlackWorkspace(BaseModel):
    team_id: str
    bot_token: str
    signing_secret: str
    installed_at: datetime
    installed_by: str
```

---

## Troubleshooting

### "url_verification failed"
- Check that your server is publicly accessible
- Verify ngrok is running and URL is correct
- Check server logs for errors

### "invalid_auth"
- Verify SLACK_BOT_TOKEN is correct
- Check token starts with `xoxb-`
- Reinstall app to workspace if needed

### "signing_secret_invalid"
- Verify SLACK_SIGNING_SECRET matches app settings
- Check for extra spaces in .env file
- Restart server after updating .env

### Buttons don't work
- Check Interactivity URL is correct
- Verify `/slack/interactions` endpoint is working
- Check server logs for errors

### Commands don't appear
- Reinstall app to workspace
- Check command is created in Slack app settings
- Verify Request URL is correct

---

## Demo Script for Investors

### Setup (Before Demo)
1. Have Slack open in browser
2. Have GitHub repo open in another tab
3. Have MidLayer app open in third tab
4. Pre-create a spec document

### Demo Flow (60 seconds)

**[0:00] The Problem**
"Right now, when a PM writes a spec, engineers spend hours translating it to code. Let me show you how we make that instant."

**[0:10] Create Spec**
*Show MidLayer editor with spec*
"Here's a spec for a payment flow. Watch what happens when I mention engineering."

**[0:15] Mention in Slack**
*Type in Slack:* `@engineering please review payment flow spec`
*Slack bot posts approval message*

**[0:20] Approve**
*Click "✅ Approve & Generate"*
"Engineer clicks approve. Now watch..."

**[0:25] Progress Updates**
*Show real-time progress in Slack*
"Our AI agent is writing production-ready code in real-time."

**[0:40] PR Created**
*PR notification appears*
"45 seconds later, we have a full PR with 247 lines of code, tests, and documentation."

**[0:45] Show GitHub**
*Switch to GitHub tab*
"Here's the actual PR. Ready to merge. No back-and-forth, no misunderstandings."

**[0:55] The Impact**
"We just saved 4-6 hours. Multiply that by every feature your team ships."

**[1:00] Close**
"That's MidLayer. Specs to shipped code in under a minute."

---

## Metrics to Track

### Engagement Metrics
```python
# Track in database
class SlackMetrics(BaseModel):
    date: date
    commands_used: int
    buttons_clicked: int
    specs_approved: int
    avg_approval_time: float  # seconds
    active_users: int
    active_channels: int
```

### Business Metrics
```python
# For pricing/growth decisions
class BusinessMetrics(BaseModel):
    workspace_id: str
    monthly_generations: int
    monthly_active_users: int
    plan_tier: str  # free, team, enterprise
    mrr: float
    upgrade_trigger: str  # hit_limit, feature_request, etc.
```

---

## Next Steps

1. ✅ Complete basic setup (Steps 1-9)
2. ✅ Test all commands and interactions
3. ✅ Deploy to production
4. ✅ Update Slack app URLs
5. ✅ Invite team members to test
6. ✅ Record demo video
7. ✅ Add to YC application

---

## Support

- Documentation: https://docs.midlayer.dev/slack
- Slack API Docs: https://api.slack.com/docs
- GitHub Issues: https://github.com/yourorg/midlayer/issues
- Email: support@midlayer.dev
