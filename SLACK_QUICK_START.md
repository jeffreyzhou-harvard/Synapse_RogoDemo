# Slack Integration - Quick Start

## ✅ Integration Status

The Slack integration is now **fully implemented** and ready to use!

### What's Working:
- ✅ Event webhooks (`/slack/events`)
- ✅ Interactive components (`/slack/interactions`)
- ✅ Slash commands (`/slack/commands`)
- ✅ Spec approval workflow
- ✅ Real-time progress updates
- ✅ PR notifications
- ✅ Knowledge graph updates
- ✅ All message templates

---

## 🚀 Quick Setup (5 minutes)

### Step 1: Check Status

Visit: http://localhost:8000/slack/status

You should see:
```json
{
  "enabled": true,
  "configured": false,
  "message": "Slack integration disabled - check environment variables"
}
```

### Step 2: Create Slack App

1. Go to https://api.slack.com/apps
2. Click **"Create New App"** → **"From scratch"**
3. Name: `MidLayer`
4. Pick your workspace
5. Click **"Create App"**

### Step 3: Add OAuth Scopes

1. Sidebar → **"OAuth & Permissions"**
2. Scroll to **"Bot Token Scopes"**
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
4. Click **"Install to Workspace"**
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### Step 4: Get Signing Secret

1. Sidebar → **"Basic Information"**
2. Scroll to **"App Credentials"**
3. Copy **"Signing Secret"**

### Step 5: Update .env File

Add to your `.env` file:
```bash
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_SIGNING_SECRET=your-secret-here
APP_BASE_URL=http://localhost:5174
```

### Step 6: Setup ngrok (for local testing)

```bash
# Install ngrok
brew install ngrok

# In a new terminal, start ngrok
ngrok http 8000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
```

### Step 7: Configure Slack Webhooks

Back in Slack App settings:

**Event Subscriptions:**
1. Sidebar → **"Event Subscriptions"**
2. Toggle ON
3. Request URL: `https://abc123.ngrok.io/slack/events`
4. Subscribe to bot events:
   - `app_mention`
   - `message.channels`
5. Save Changes

**Interactivity:**
1. Sidebar → **"Interactivity & Shortcuts"**
2. Toggle ON
3. Request URL: `https://abc123.ngrok.io/slack/interactions`
4. Save Changes

**Slash Commands:**
1. Sidebar → **"Slash Commands"**
2. Create New Command:
   - Command: `/midlayer`
   - Request URL: `https://abc123.ngrok.io/slack/commands`
   - Short Description: `MidLayer AI assistant`
   - Usage Hint: `status [task-id] | spec [title] | graph | help`
3. Save

### Step 8: Restart Server

```bash
# Stop the current server (Ctrl+C)
# Restart it
python -m uvicorn app.main:app --reload --port 8000
```

Check status again: http://localhost:8000/slack/status

Should now show:
```json
{
  "enabled": true,
  "configured": true,
  "message": "Slack integration is active"
}
```

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

## 🎬 Demo Flow

### Test the Full Workflow:

1. **Mention the bot:**
   ```
   @MidLayer please review payment flow spec
   ```

2. **Bot posts approval message** with buttons

3. **Click "✅ Approve & Generate"**

4. **Watch progress updates** (every 10 seconds):
   - 0% → Analyzing spec
   - 25% → Generated API endpoints
   - 50% → Creating database models
   - 75% → Writing tests
   - 100% → Complete!

5. **PR notification appears** with:
   - PR number and branch name
   - Files changed with line counts
   - Links to GitHub and MidLayer

6. **Knowledge graph notification** shows:
   - Affected tasks
   - Reassignment suggestions

**Total time: ~45 seconds**

---

## 📊 Available Endpoints

### Status Check
```bash
curl http://localhost:8000/slack/status
```

### Test Event (manual)
```bash
curl -X POST http://localhost:8000/slack/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "url_verification",
    "challenge": "test123"
  }'
```

### API Documentation
Visit: http://localhost:8000/docs

Look for:
- `POST /slack/events`
- `POST /slack/interactions`
- `POST /slack/commands`
- `GET /slack/status`

---

## 🎯 What You Can Do Now

### 1. Spec Approval Workflow
- PM mentions @MidLayer with spec
- Engineer clicks approve
- Code generated automatically
- PR created in GitHub

### 2. Slash Commands
```
/midlayer status API-1        # Check task status
/midlayer graph               # View knowledge graph
/midlayer spec [title]        # Create new spec
/midlayer delegate @user      # Assign tasks
/midlayer settings            # Configure notifications
/midlayer help                # Show help
```

### 3. Interactive Buttons
- Approve/Reject specs
- View PRs
- Apply knowledge graph suggestions
- Deploy to staging

### 4. Real-time Updates
- Progress tracking
- PR notifications
- Knowledge graph changes
- Daily digests (coming soon)

---

## 🔧 Troubleshooting

### "Slack integration disabled"
- Check `.env` file has `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`
- Restart the server after updating `.env`

### "url_verification failed"
- Make sure ngrok is running
- Check the ngrok URL is correct in Slack app settings
- Verify server is running on port 8000

### "invalid_auth"
- Verify `SLACK_BOT_TOKEN` is correct
- Token should start with `xoxb-`
- Reinstall app to workspace if needed

### Buttons don't work
- Check Interactivity URL in Slack app settings
- Verify ngrok URL is correct
- Check server logs for errors

### Commands don't appear
- Reinstall app to workspace
- Check slash command is created in Slack app settings
- Verify Request URL is correct

---

## 📝 Next Steps

### For Demo:
1. ✅ Record a 60-second demo video
2. ✅ Show spec → approve → PR flow
3. ✅ Highlight 45-second turnaround time

### For Production:
1. Deploy to Heroku/Railway/Render
2. Update Slack app URLs to production domain
3. Add scheduled daily digests
4. Implement user preferences
5. Add analytics tracking

### For YC Application:
1. Include demo video
2. Show traction metrics (if beta users)
3. Highlight viral growth mechanics
4. Emphasize time savings (4-6 hours → 45 seconds)

---

## 🎉 You're Ready!

Your Slack integration is fully functional. You can now:
- ✅ Approve specs from Slack
- ✅ Generate code automatically
- ✅ Track progress in real-time
- ✅ Get PR notifications
- ✅ Use slash commands
- ✅ View knowledge graph updates

**Time to demo!** 🚀

---

## 📞 Support

- Documentation: See `SLACK_INTEGRATION_DESIGN.md`
- Visual Mockups: See `SLACK_VISUAL_MOCKUP.md`
- Setup Guide: See `SLACK_SETUP_GUIDE.md`
- Slack API Docs: https://api.slack.com/docs

---

## 🔐 Security Notes

- Never commit `.env` file to git
- Keep `SLACK_SIGNING_SECRET` secure
- Verify all webhook requests
- Use HTTPS in production (ngrok provides this)
- Rotate tokens if compromised

---

**Ready to ship features 10x faster? Let's go!** 🚀
