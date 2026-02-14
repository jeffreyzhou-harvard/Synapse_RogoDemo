"""
FastAPI endpoints for Slack integration
Add these to main.py or import as a router
"""

from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Dict, Any, Optional
import json
from .slack_service import SlackService
from .agent_service import AgentService

# Initialize services
slack = SlackService()
agent_service = AgentService()


class SlackEventPayload(BaseModel):
    """Slack event webhook payload"""
    type: str
    challenge: Optional[str] = None
    event: Optional[Dict[str, Any]] = None


class SlackInteractionPayload(BaseModel):
    """Slack interactive component payload"""
    type: str
    user: Dict[str, Any]
    actions: list
    channel: Dict[str, Any]
    message: Optional[Dict[str, Any]] = None
    response_url: str


class SlackCommandPayload(BaseModel):
    """Slack slash command payload"""
    command: str
    text: str
    user_id: str
    channel_id: str
    response_url: str


# Webhook Endpoints

async def slack_events(request: Request):
    """
    Handle Slack events (messages, mentions, etc.)
    POST /slack/events
    """
    # Verify request signature
    timestamp = request.headers.get('X-Slack-Request-Timestamp', '')
    signature = request.headers.get('X-Slack-Signature', '')
    body = await request.body()
    
    if not slack.verify_request(timestamp, signature, body.decode()):
        raise HTTPException(status_code=401, detail="Invalid signature")
    
    payload = await request.json()
    
    # Handle URL verification challenge
    if payload.get('type') == 'url_verification':
        return JSONResponse(content={'challenge': payload['challenge']})
    
    # Handle events
    event = payload.get('event', {})
    event_type = event.get('type')
    
    if event_type == 'app_mention':
        await handle_app_mention(event)
    elif event_type == 'message':
        await handle_message(event)
    
    return JSONResponse(content={'ok': True})


async def slack_interactions(request: Request, background_tasks: BackgroundTasks):
    """
    Handle Slack interactive components (buttons, menus, etc.)
    POST /slack/interactions
    """
    # Parse form data (Slack sends as application/x-www-form-urlencoded)
    form_data = await request.form()
    payload = json.loads(form_data.get('payload', '{}'))
    
    action_type = payload.get('type')
    actions = payload.get('actions', [])
    user = payload.get('user', {})
    channel = payload.get('channel', {})
    message = payload.get('message', {})
    response_url = payload.get('response_url')
    
    if not actions:
        return JSONResponse(content={'ok': True})
    
    action = actions[0]
    action_id = action.get('action_id')
    value = action.get('value')
    
    # Handle different action types
    if action_id == 'approve_spec':
        background_tasks.add_task(handle_spec_approval, value, user, channel, response_url)
        return JSONResponse(content={
            'text': '⚙️ Generating code... This will take about 45 seconds.'
        })
    
    elif action_id == 'reject_spec':
        return JSONResponse(content={
            'text': '❌ Spec rejected. The author will be notified.'
        })
    
    elif action_id == 'review_spec':
        return JSONResponse(content={
            'text': '👀 Opening spec in browser...'
        })
    
    elif action_id == 'view_knowledge_graph':
        return JSONResponse(content={
            'text': '🧠 Opening knowledge graph...'
        })
    
    elif action_id == 'apply_kg_suggestions':
        background_tasks.add_task(handle_kg_suggestions, value, user, channel)
        return JSONResponse(content={
            'text': '✅ Applying reassignment suggestions...'
        })
    
    return JSONResponse(content={'ok': True})


async def slack_commands(request: Request):
    """
    Handle Slack slash commands
    POST /slack/commands
    """
    # Parse form data
    form_data = await request.form()
    
    command = form_data.get('command')
    text = form_data.get('text', '')
    user_id = form_data.get('user_id')
    channel_id = form_data.get('channel_id')
    response_url = form_data.get('response_url')
    
    # Handle the command
    response = slack.handle_slash_command(command, text, user_id, channel_id)
    
    return JSONResponse(content=response)


# Background Task Handlers

async def handle_app_mention(event: Dict[str, Any]):
    """Handle @midlayer mentions in messages"""
    text = event.get('text', '')
    channel = event.get('channel')
    user = event.get('user')
    
    # Check if this is a spec review request
    if 'review' in text.lower() and 'spec' in text.lower():
        # Extract spec ID or title from message
        # For demo, use mock data
        spec_data = {
            'spec_id': 'spec_abc123',
            'title': 'Payment Flow Implementation',
            'author_id': user,
            'estimated_files': 3,
            'estimated_lines': 247,
            'estimated_endpoints': 2,
            'estimated_hours': '4-6 hours',
            'spec_url': 'https://app.midlayer.dev/editor/abc123'
        }
        
        blocks = slack.create_spec_approval_message(spec_data)
        slack.post_message(channel, blocks, text="New spec ready for review")


async def handle_message(event: Dict[str, Any]):
    """Handle regular messages (for future features)"""
    # Could be used for conversational AI features
    pass


async def handle_spec_approval(spec_id: str, user: Dict, channel: Dict, response_url: str):
    """
    Background task: Generate code when spec is approved
    """
    import asyncio
    import requests
    
    # Update message to show progress
    progress_data = {
        'agent_id': 'a3f7',
        'progress': 0,
        'steps': [
            {'name': 'Analyzing spec requirements', 'status': 'in_progress'},
            {'name': 'Generating API endpoints', 'status': 'pending'},
            {'name': 'Creating database models', 'status': 'pending'},
            {'name': 'Writing tests', 'status': 'pending'}
        ],
        'last_update': 'just now'
    }
    
    blocks = slack.create_progress_message(progress_data)
    requests.post(response_url, json={'blocks': blocks, 'replace_original': False})
    
    # Simulate progress updates
    await asyncio.sleep(10)
    progress_data['progress'] = 25
    progress_data['steps'][0]['status'] = 'completed'
    progress_data['steps'][1]['status'] = 'in_progress'
    blocks = slack.create_progress_message(progress_data)
    requests.post(response_url, json={'blocks': blocks, 'replace_original': True})
    
    await asyncio.sleep(10)
    progress_data['progress'] = 50
    progress_data['steps'][1]['status'] = 'completed'
    progress_data['steps'][2]['status'] = 'in_progress'
    blocks = slack.create_progress_message(progress_data)
    requests.post(response_url, json={'blocks': blocks, 'replace_original': True})
    
    await asyncio.sleep(15)
    progress_data['progress'] = 75
    progress_data['steps'][2]['status'] = 'completed'
    progress_data['steps'][3]['status'] = 'in_progress'
    blocks = slack.create_progress_message(progress_data)
    requests.post(response_url, json={'blocks': blocks, 'replace_original': True})
    
    await asyncio.sleep(10)
    
    # Generate actual code using agent service
    # For demo, use mock data
    pr_data = {
        'pr_number': 247,
        'branch_name': 'midlayer-payment-flow-1110',
        'files': [
            {'path': 'api/payments.py', 'additions': 156},
            {'path': 'models/transaction.py', 'additions': 67},
            {'path': 'tests/test_payments.py', 'additions': 24}
        ],
        'pr_url': 'https://github.com/yourorg/yourrepo/pull/247',
        'midlayer_url': 'https://app.midlayer.dev/tasks/API-1'
    }
    
    # Post PR notification
    blocks = slack.create_pr_notification_message(pr_data)
    slack.post_message(
        channel['id'],
        blocks,
        text=f"PR #{pr_data['pr_number']} created successfully"
    )
    
    # Update knowledge graph and send notification
    kg_data = {
        'completed_task': 'Payment Flow Implementation',
        'agent_id': 'a3f7',
        'affected_tasks': [
            {'title': 'Refund Processing', 'status': 'unblocked'},
            {'title': 'Payment Analytics Dashboard', 'status': 'context available'}
        ],
        'graph_id': 'kg_123'
    }
    
    blocks = slack.create_knowledge_graph_notification(kg_data)
    slack.post_message(
        channel['id'],
        blocks,
        text="Knowledge graph updated"
    )


async def handle_kg_suggestions(graph_id: str, user: Dict, channel: Dict):
    """
    Background task: Apply knowledge graph reassignment suggestions
    """
    # Apply suggestions from knowledge graph
    # Update task assignments
    # Notify affected team members
    pass


# Daily Digest Scheduler (would be called by a cron job)

async def send_daily_digest(channel_id: str):
    """
    Send daily digest to a channel
    Should be called by a scheduler (e.g., APScheduler, Celery)
    """
    digest_data = {
        'specs_to_code': 5,
        'prs_merged': 8,
        'rework_cycles': 0,
        'top_agent': 'a3f7',
        'top_agent_stats': '3 tasks completed, 100% merge rate',
        'tasks_ready': 4,
        'specs_awaiting': 2,
        'deployments_scheduled': 1,
        'report_url': 'https://app.midlayer.dev/analytics',
        'planner_url': 'https://app.midlayer.dev/planner'
    }
    
    blocks = slack.create_daily_digest_message(digest_data)
    slack.post_message(channel_id, blocks, text="Your daily MidLayer digest")


# Error Handling

async def send_error_notification(channel_id: str, error_data: Dict):
    """Send friendly error notification to channel"""
    blocks = slack.create_error_message(error_data)
    slack.post_message(channel_id, blocks, text="Error occurred")


# Add these routes to your FastAPI app:
"""
app.add_api_route("/slack/events", slack_events, methods=["POST"])
app.add_api_route("/slack/interactions", slack_interactions, methods=["POST"])
app.add_api_route("/slack/commands", slack_commands, methods=["POST"])
"""
