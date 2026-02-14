# Slack Integration Design

## Overview
Transform design docs into shipped code through Slack's familiar interface. Engineers approve specs, track progress, and review PRs without leaving Slack.

---

## User Flows

### Flow 1: Spec Approval & Auto-Implementation
```
1. PM writes spec in MidLayer editor
2. PM types: "@engineering please review payment flow spec"
3. Slack bot posts to #engineering:
   ┌─────────────────────────────────────────────┐
   │ 🎯 New Spec Ready for Review                │
   │                                             │
   │ Payment Flow Implementation                 │
   │ By: @sarah_pm                              │
   │                                             │
   │ 📊 Estimated Impact:                        │
   │ • 3 files to create                        │
   │ • ~247 lines of code                       │
   │ • 2 API endpoints                          │
   │ • Estimated time: 4-6 hours                │
   │                                             │
   │ 🔗 View Full Spec                          │
   │                                             │
   │ [✅ Approve & Generate] [👀 Review] [❌ Reject] │
   └─────────────────────────────────────────────┘

4. Engineer clicks "✅ Approve & Generate"
5. Bot replies in thread:
   "⚙️ Generating code... (Agent #a3f7 assigned)"

6. 45 seconds later:
   ┌─────────────────────────────────────────────┐
   │ ✅ Code Generated Successfully              │
   │                                             │
   │ 📝 Created PR #247                          │
   │ Branch: midlayer-payment-flow-1110          │
   │                                             │
   │ Files Changed:                              │
   │ • api/payments.py (+156 lines)             │
   │ • models/transaction.py (+67 lines)        │
   │ • tests/test_payments.py (+24 lines)       │
   │                                             │
   │ 🔗 View PR on GitHub                       │
   │ 📊 View in MidLayer                        │
   │                                             │
   │ [🚀 Deploy to Staging] [💬 Add Comment]    │
   └─────────────────────────────────────────────┘
```

---

### Flow 2: Real-Time Progress Updates
```
When agent is working:

⚙️ Agent #a3f7 Progress (45% complete)
├─ ✅ Analyzed spec requirements
├─ ✅ Generated API endpoints
├─ 🔄 Creating database models...
└─ ⏳ Writing tests

Updated 3 seconds ago
```

---

### Flow 3: Interactive Code Review in Slack
```
Engineer types: "/midlayer review PR-247"

Bot shows inline diff:
┌─────────────────────────────────────────────┐
│ 📄 api/payments.py                          │
│                                             │
│ + @app.post("/api/payments/process")       │
│ + async def process_payment(               │
│ +     payment: PaymentRequest,             │
│ +     user: User = Depends(get_user)       │
│ + ):                                        │
│ +     """Process a payment transaction""" │
│                                             │
│ 💬 Add inline comment                      │
│ [✅ Approve File] [🔄 Request Changes]      │
└─────────────────────────────────────────────┘

[< Previous File] [Next File >] [Approve All]
```

---

### Flow 4: Knowledge Graph Notifications
```
When task completes, bot notifies affected tasks:

🧠 Knowledge Graph Update

Task "Payment Flow" completed by Agent #a3f7

📊 Impact Analysis:
• 2 related tasks can now start:
  → "Refund Processing" (unblocked)
  → "Payment Analytics Dashboard" (context available)

• Suggested reassignment:
  → Move "Stripe Integration" to Agent #a3f7
    (has fresh context on payment models)

[📋 View Full Graph] [✅ Apply Suggestions]
```

---

## Slash Commands

### `/midlayer spec [title]`
Create a new spec directly from Slack
```
/midlayer spec User Authentication Flow

Bot creates draft and replies:
✅ Created new spec: "User Authentication Flow"
🔗 Edit in MidLayer: https://app.midlayer.dev/editor/abc123
📝 Type your requirements here, or click link to use full editor
```

### `/midlayer status [task-id]`
Check task/PR status
```
/midlayer status API-1

📊 Task Status: API-1
Title: Design task management REST API
Status: In Progress (67% complete)
Agent: #a3f7
Branch: midlayer-api-task-mgmt-1110

Recent Activity:
• 2 min ago: Created endpoints.py
• 5 min ago: Updated schema definitions
• 8 min ago: Started code generation

[🔗 View PR] [⏸️ Pause] [🛑 Cancel]
```

### `/midlayer graph`
View knowledge graph summary
```
/midlayer graph

🧠 Knowledge Graph Overview
📊 16 tasks • 24 relationships • 3 active agents

Critical Path:
API-1 → DB-1 → FE-1 → TEST-1 → DEPLOY-1

Bottlenecks:
⚠️ DB-1 blocking 4 downstream tasks
⚠️ Agent #a3f7 at 90% capacity

[📈 View Full Graph] [🔄 Optimize Assignments]
```

### `/midlayer delegate @user [task]`
Assign task to team member
```
/midlayer delegate @john Build payment dashboard

✅ Task created and assigned to @john
📋 Task ID: FE-3
🤖 AI Assistant available for code generation

@john will be notified and can start with:
/midlayer start FE-3
```

---

## Interactive Workflows

### Approval Workflow with Conditions
```
When spec has security implications:

⚠️ Security Review Required

This spec involves:
• User authentication
• Payment processing
• PII data handling

Required approvals:
☐ Engineering Lead (@mike)
☐ Security Team (@security-team)
☐ Product Manager (@sarah_pm)

[✅ Approve] [📝 Add Security Notes] [❌ Reject]

Once all approve → Auto-generate code
```

### Multi-Stage Deployment
```
After PR merged:

🚀 Deployment Pipeline

✅ PR #247 merged to main

Next steps:
[🧪 Deploy to Dev] ← Click to start
↓
[🔬 Run Integration Tests]
↓
[🎭 Deploy to Staging]
↓
[✅ Deploy to Production]

Auto-deploy enabled: Will proceed if tests pass
[⏸️ Pause Auto-Deploy] [⚙️ Configure]
```

---

## Notification Settings

Users can configure what they see:
```
/midlayer settings

📬 Notification Preferences

Notify me when:
✅ My specs are reviewed
✅ PRs are ready for my review
✅ Tasks I'm assigned to are unblocked
✅ Knowledge graph suggests reassignment
☐ Any task completes
☐ Agent starts working
☐ Daily digest (9am)

Channels:
• #engineering - All PR notifications
• #product - Spec reviews only
• DM - Urgent items only

[💾 Save Settings]
```

---

## Bot Personality & Tone

### Friendly & Informative
```
✨ Great news! Your spec "Payment Flow" is ready for implementation.

I've analyzed the requirements and here's what I can build:
• 3 new API endpoints
• Database schema with 2 tables
• Comprehensive test suite

Want me to get started? Just click the button below! 🚀

[✅ Let's do this!] [👀 Show me details first]
```

### Progress Updates
```
🏃‍♂️ Agent #a3f7 is on it!

Making great progress on your payment flow:
✅ API structure designed
✅ Database models created
🔄 Writing business logic... (2 min remaining)

You can grab a coffee ☕ - I'll ping you when it's ready!
```

### Error Handling
```
😅 Oops! Hit a small snag

I couldn't generate code for "Payment Flow" because:
• Missing Stripe API configuration
• Database connection string not set

Quick fixes:
1. Add STRIPE_API_KEY to .env
2. Run: /midlayer config database

Need help? Type /midlayer help or ping @midlayer-support

[🔧 Fix Config] [📖 View Docs] [💬 Get Help]
```

---

## Analytics in Slack

### Daily Digest
```
📊 Your Daily MidLayer Digest

Good morning! Here's what happened yesterday:

Velocity:
• 5 specs → code (avg 12 min each) ⚡
• 8 PRs merged
• 0 rework cycles 🎉

Top Performer:
🏆 Agent #a3f7 - 3 tasks completed, 100% merge rate

Upcoming:
• 4 tasks ready to start
• 2 specs awaiting review
• 1 deployment scheduled for 2pm

[📈 View Full Report] [🎯 Plan Today]
```

### Weekly Team Report
```
📈 Weekly Team Report (Nov 4-10)

🚀 Shipped:
• 23 features completed
• 47 PRs merged
• 2,847 lines of code generated

⚡ Speed:
• Avg spec-to-PR: 14 minutes (↓ 85% vs manual)
• Avg PR-to-merge: 3.2 hours
• Zero production incidents

💰 Impact:
• ~187 engineering hours saved
• Est. cost savings: $14,960
• Team velocity: +340%

🧠 Knowledge Graph:
• 89 tasks tracked
• 156 relationships mapped
• 12 active agents

[🎊 Share with team] [📊 Detailed analytics]
```

---

## Technical Architecture

### Webhook Events
```python
# Slack sends events to your server
POST /slack/events
{
  "type": "message",
  "channel": "C123456",
  "user": "U789012",
  "text": "@engineering please review payment spec",
  "ts": "1699999999.123456"
}
```

### Interactive Components
```python
# User clicks button → Slack sends payload
POST /slack/interactions
{
  "type": "block_actions",
  "actions": [{
    "action_id": "approve_spec",
    "value": "spec_abc123"
  }],
  "user": {"id": "U789012"},
  "response_url": "https://hooks.slack.com/..."
}
```

### Slash Commands
```python
# User types /midlayer command
POST /slack/commands
{
  "command": "/midlayer",
  "text": "status API-1",
  "user_id": "U789012",
  "channel_id": "C123456",
  "response_url": "https://hooks.slack.com/..."
}
```

---

## Security & Permissions

### OAuth Scopes Required
```
Bot Token Scopes:
- chat:write (send messages)
- chat:write.public (post to any channel)
- commands (slash commands)
- files:read (read uploaded specs)
- users:read (get user info)
- channels:read (list channels)
- im:write (send DMs)

User Token Scopes:
- identity.basic (user identification)
- identity.email (link to MidLayer account)
```

### Permission Checks
```python
# Only approved users can trigger code generation
if not user.has_permission("approve_specs"):
    return "⛔ You need 'Engineer' role to approve specs"

# Sensitive operations require admin
if action == "deploy_production":
    if not user.is_admin:
        return "⛔ Production deploys require admin approval"
```

---

## Pricing Hook

### Freemium Limits
```
When free tier limit reached:

⚠️ Monthly Limit Reached

You've used all 10 AI generations this month! 🎉

Your team is shipping fast! Upgrade to keep the momentum:

📦 Team Plan ($49/user/month)
• Unlimited AI generations
• Priority agent assignment
• Advanced analytics
• GitHub integration

[🚀 Upgrade Now] [📊 View Usage] [💬 Talk to Sales]

Or wait 12 days for your limit to reset.
```

---

## Implementation Priority

### Phase 1 (Week 1): Core Integration
- ✅ Webhook receiver
- ✅ Spec approval flow
- ✅ PR notifications
- ✅ Basic slash commands

### Phase 2 (Week 2): Interactive Features
- ✅ Inline code review
- ✅ Progress updates
- ✅ Knowledge graph notifications
- ✅ Multi-stage approvals

### Phase 3 (Week 3): Analytics & Polish
- ✅ Daily/weekly digests
- ✅ Usage tracking for billing
- ✅ Notification preferences
- ✅ Error handling & help

---

## Success Metrics

### Engagement
- % of specs approved via Slack (target: >80%)
- Time to first approval (target: <5 min)
- Slash command usage (target: 10/user/week)

### Viral Growth
- Invites per active user (target: 2.5)
- Channel adoption rate (target: 50% of eng channels)
- Cross-team spread (target: 3 teams/company)

### Business Impact
- Conversion: Free → Paid (target: 25%)
- Upgrade trigger: Hit generation limit (target: 60% upgrade)
- Retention: 90-day (target: >70%)

---

## Demo Script for YC

**Setup (5 seconds):**
"Let me show you how fast we can go from idea to shipped code."

**Action (30 seconds):**
1. Open Slack
2. Show spec notification
3. Click "Approve & Generate"
4. Watch progress updates
5. PR appears with full diff

**Impact (10 seconds):**
"That was 45 seconds. The old way? 4-6 hours of back-and-forth. We just made your team 10x faster."

**Close (5 seconds):**
"And every interaction trains our knowledge graph, making the next feature even faster."

---

## Next Steps

1. **Set up Slack app** in Slack App Directory
2. **Implement webhook handlers** (see slack_service.py below)
3. **Design Block Kit templates** for rich messages
4. **Test with beta users** in your own Slack
5. **Record demo video** for YC application
