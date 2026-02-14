"""
Slack Integration Service for MidLayer
Handles webhooks, interactive components, and slash commands
"""

import os
import json
import hmac
import hashlib
from typing import Dict, List, Optional, Any
from datetime import datetime

try:
    import requests
except ImportError:
    requests = None  # type: ignore

from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(dotenv_path=_ENV_PATH, override=True)


class SlackService:
    def __init__(self):
        self.bot_token = os.getenv('SLACK_BOT_TOKEN')
        self.signing_secret = os.getenv('SLACK_SIGNING_SECRET')
        self.base_url = 'https://slack.com/api'
        self.app_base_url = os.getenv('APP_BASE_URL', 'http://localhost:5174')
        
        if not requests:
            raise ValueError("requests library not installed. Run: pip install requests")
        
        if not self.bot_token:
            print("Warning: SLACK_BOT_TOKEN not set in environment. Slack integration will not work.")
    
    def _headers(self) -> Dict[str, str]:
        return {
            'Authorization': f'Bearer {self.bot_token}',
            'Content-Type': 'application/json'
        }
    
    def verify_request(self, timestamp: str, signature: str, body: str) -> bool:
        """Verify that request came from Slack"""
        if not self.signing_secret:
            return False
        
        # Check timestamp is recent (within 5 minutes)
        current_time = int(datetime.now().timestamp())
        if abs(current_time - int(timestamp)) > 60 * 5:
            return False
        
        # Verify signature
        sig_basestring = f"v0:{timestamp}:{body}"
        my_signature = 'v0=' + hmac.new(
            self.signing_secret.encode(),
            sig_basestring.encode(),
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(my_signature, signature)
    
    def post_message(self, channel: str, blocks: List[Dict], text: str = "") -> Dict:
        """Post a rich message to a channel"""
        url = f"{self.base_url}/chat.postMessage"
        payload = {
            'channel': channel,
            'blocks': blocks,
            'text': text  # Fallback text for notifications
        }
        
        response = requests.post(url, headers=self._headers(), json=payload)
        response.raise_for_status()
        return response.json()
    
    def update_message(self, channel: str, ts: str, blocks: List[Dict], text: str = "") -> Dict:
        """Update an existing message"""
        url = f"{self.base_url}/chat.update"
        payload = {
            'channel': channel,
            'ts': ts,
            'blocks': blocks,
            'text': text
        }
        
        response = requests.post(url, headers=self._headers(), json=payload)
        response.raise_for_status()
        return response.json()
    
    def post_ephemeral(self, channel: str, user: str, blocks: List[Dict], text: str = "") -> Dict:
        """Post a message only visible to specific user"""
        url = f"{self.base_url}/chat.postEphemeral"
        payload = {
            'channel': channel,
            'user': user,
            'blocks': blocks,
            'text': text
        }
        
        response = requests.post(url, headers=self._headers(), json=payload)
        response.raise_for_status()
        return response.json()
    
    def get_user_info(self, user_id: str) -> Dict:
        """Get user information"""
        url = f"{self.base_url}/users.info"
        params = {'user': user_id}
        
        response = requests.get(url, headers=self._headers(), params=params)
        response.raise_for_status()
        return response.json()
    
    def create_spec_approval_message(self, spec_data: Dict) -> List[Dict]:
        """Create rich message blocks for spec approval"""
        return [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "🎯 New Spec Ready for Review"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*{spec_data['title']}*\nBy: <@{spec_data['author_id']}>"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"📊 *Estimated Impact:*\n"
                           f"• {spec_data['estimated_files']} files to create\n"
                           f"• ~{spec_data['estimated_lines']} lines of code\n"
                           f"• {spec_data['estimated_endpoints']} API endpoints\n"
                           f"• Estimated time: {spec_data['estimated_hours']}"
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "✅ Approve & Generate"},
                        "style": "primary",
                        "action_id": "approve_spec",
                        "value": spec_data['spec_id']
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "👀 Review"},
                        "action_id": "review_spec",
                        "value": spec_data['spec_id'],
                        "url": spec_data['spec_url']
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "❌ Reject"},
                        "style": "danger",
                        "action_id": "reject_spec",
                        "value": spec_data['spec_id']
                    }
                ]
            }
        ]
    
    def create_pr_notification_message(self, pr_data: Dict) -> List[Dict]:
        """Create rich message blocks for PR notification"""
        files_text = "\n".join([
            f"• `{f['path']}` (+{f['additions']} lines)"
            for f in pr_data['files'][:5]  # Show first 5 files
        ])
        
        if len(pr_data['files']) > 5:
            files_text += f"\n• ... and {len(pr_data['files']) - 5} more files"
        
        return [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "✅ Code Generated Successfully"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"📝 *Created PR #{pr_data['pr_number']}*\n"
                           f"Branch: `{pr_data['branch_name']}`"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Files Changed:*\n{files_text}"
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "🔗 View PR on GitHub"},
                        "url": pr_data['pr_url']
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "📊 View in MidLayer"},
                        "url": pr_data['midlayer_url']
                    }
                ]
            }
        ]
    
    def create_progress_message(self, task_data: Dict) -> List[Dict]:
        """Create progress update message"""
        progress_items = []
        for step in task_data['steps']:
            emoji = "✅" if step['status'] == 'completed' else "🔄" if step['status'] == 'in_progress' else "⏳"
            progress_items.append(f"{emoji} {step['name']}")
        
        progress_text = "\n".join(progress_items)
        
        return [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"⚙️ *Agent #{task_data['agent_id']} Progress* ({task_data['progress']}% complete)\n\n{progress_text}"
                }
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"Updated {task_data['last_update']}"
                    }
                ]
            }
        ]
    
    def create_knowledge_graph_notification(self, kg_data: Dict) -> List[Dict]:
        """Create knowledge graph update notification"""
        impact_text = "\n".join([
            f"  → {task['title']} ({task['status']})"
            for task in kg_data['affected_tasks'][:3]
        ])
        
        return [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "🧠 Knowledge Graph Update"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"Task *\"{kg_data['completed_task']}\"* completed by Agent #{kg_data['agent_id']}"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"📊 *Impact Analysis:*\n"
                           f"• {len(kg_data['affected_tasks'])} related tasks can now start:\n{impact_text}"
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "📋 View Full Graph"},
                        "action_id": "view_knowledge_graph",
                        "value": kg_data['graph_id']
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "✅ Apply Suggestions"},
                        "style": "primary",
                        "action_id": "apply_kg_suggestions",
                        "value": kg_data['graph_id']
                    }
                ]
            }
        ]
    
    def create_daily_digest_message(self, digest_data: Dict) -> List[Dict]:
        """Create daily digest message"""
        return [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "📊 Your Daily MidLayer Digest"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"Good morning! Here's what happened yesterday:"
                }
            },
            {
                "type": "section",
                "fields": [
                    {
                        "type": "mrkdwn",
                        "text": f"*Velocity:*\n• {digest_data['specs_to_code']} specs → code\n• {digest_data['prs_merged']} PRs merged\n• {digest_data['rework_cycles']} rework cycles"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Top Performer:*\n🏆 Agent #{digest_data['top_agent']}\n{digest_data['top_agent_stats']}"
                    }
                ]
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Upcoming:*\n"
                           f"• {digest_data['tasks_ready']} tasks ready to start\n"
                           f"• {digest_data['specs_awaiting']} specs awaiting review\n"
                           f"• {digest_data['deployments_scheduled']} deployment scheduled"
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "📈 View Full Report"},
                        "url": digest_data['report_url']
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "🎯 Plan Today"},
                        "url": digest_data['planner_url']
                    }
                ]
            }
        ]
    
    def create_error_message(self, error_data: Dict) -> List[Dict]:
        """Create friendly error message"""
        return [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"😅 *Oops! Hit a small snag*\n\n"
                           f"I couldn't generate code for \"{error_data['task_title']}\" because:\n"
                           f"• {error_data['error_message']}"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Quick fixes:*\n{error_data['suggestions']}"
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "🔧 Fix Config"},
                        "action_id": "fix_config",
                        "value": error_data['task_id']
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "📖 View Docs"},
                        "url": error_data['docs_url']
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "💬 Get Help"},
                        "action_id": "get_help",
                        "value": error_data['task_id']
                    }
                ]
            }
        ]
    
    def handle_slash_command(self, command: str, text: str, user_id: str, channel_id: str) -> Dict:
        """Handle /midlayer slash commands"""
        parts = text.strip().split(maxsplit=1)
        subcommand = parts[0] if parts else "help"
        args = parts[1] if len(parts) > 1 else ""
        
        if subcommand == "status":
            return self._handle_status_command(args, user_id, channel_id)
        elif subcommand == "spec":
            return self._handle_spec_command(args, user_id, channel_id)
        elif subcommand == "graph":
            return self._handle_graph_command(user_id, channel_id)
        elif subcommand == "delegate":
            return self._handle_delegate_command(args, user_id, channel_id)
        elif subcommand == "settings":
            return self._handle_settings_command(user_id, channel_id)
        else:
            return self._handle_help_command(user_id, channel_id)
    
    def _handle_status_command(self, task_id: str, user_id: str, channel_id: str) -> Dict:
        """Handle /midlayer status [task-id]"""
        # This would fetch actual task data from your backend
        return {
            "response_type": "ephemeral",
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"📊 *Task Status: {task_id}*\n"
                               f"Title: Design task management REST API\n"
                               f"Status: In Progress (67% complete)\n"
                               f"Agent: #a3f7\n"
                               f"Branch: midlayer-api-task-mgmt-1110"
                    }
                }
            ]
        }
    
    def _handle_spec_command(self, title: str, user_id: str, channel_id: str) -> Dict:
        """Handle /midlayer spec [title]"""
        return {
            "response_type": "ephemeral",
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"✅ Created new spec: *\"{title}\"*\n"
                               f"🔗 Edit in MidLayer: https://app.midlayer.dev/editor/abc123\n"
                               f"📝 Type your requirements here, or click link to use full editor"
                    }
                }
            ]
        }
    
    def _handle_graph_command(self, user_id: str, channel_id: str) -> Dict:
        """Handle /midlayer graph"""
        return {
            "response_type": "ephemeral",
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "🧠 *Knowledge Graph Overview*\n"
                               "📊 16 tasks • 24 relationships • 3 active agents\n\n"
                               "*Critical Path:*\nAPI-1 → DB-1 → FE-1 → TEST-1 → DEPLOY-1\n\n"
                               "*Bottlenecks:*\n⚠️ DB-1 blocking 4 downstream tasks\n⚠️ Agent #a3f7 at 90% capacity"
                    }
                }
            ]
        }
    
    def _handle_delegate_command(self, args: str, user_id: str, channel_id: str) -> Dict:
        """Handle /midlayer delegate @user [task]"""
        return {
            "response_type": "in_channel",
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"✅ Task created and assigned\n"
                               f"📋 Task ID: FE-3\n"
                               f"🤖 AI Assistant available for code generation"
                    }
                }
            ]
        }
    
    def _handle_settings_command(self, user_id: str, channel_id: str) -> Dict:
        """Handle /midlayer settings"""
        return {
            "response_type": "ephemeral",
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "📬 *Notification Preferences*\n\n"
                               "Notify me when:\n"
                               "✅ My specs are reviewed\n"
                               "✅ PRs are ready for my review\n"
                               "✅ Tasks I'm assigned to are unblocked"
                    }
                }
            ]
        }
    
    def _handle_help_command(self, user_id: str, channel_id: str) -> Dict:
        """Handle /midlayer help"""
        return {
            "response_type": "ephemeral",
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "*MidLayer Slash Commands*\n\n"
                               "`/midlayer spec [title]` - Create a new spec\n"
                               "`/midlayer status [task-id]` - Check task status\n"
                               "`/midlayer graph` - View knowledge graph\n"
                               "`/midlayer delegate @user [task]` - Assign task\n"
                               "`/midlayer settings` - Configure notifications\n"
                               "`/midlayer help` - Show this help"
                    }
                }
            ]
        }
