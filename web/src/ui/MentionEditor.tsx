import React, { useState, useRef, useEffect } from 'react';

interface MentionEditorProps {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onTextSelect?: (selectedText: string, rect: { top: number; left: number; width: number; height: number }) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  isFocused?: boolean;
}

interface MentionMatch {
  start: number;
  end: number;
  username: string;
  fullMatch: string;
}

const MentionEditor: React.FC<MentionEditorProps> = ({
  value,
  onChange,
  onFocus,
  onBlur,
  onTextSelect,
  placeholder = "Start writing...",
  style = {},
  isFocused = false
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);

  // Detect @mentions in text
  const detectMentions = (text: string): MentionMatch[] => {
    const mentions: MentionMatch[] = [];
    const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push({
        start: match.index,
        end: match.index + match[0].length,
        username: match[1],
        fullMatch: match[0]
      });
    }

    return mentions;
  };

  // Detect @mentions with task content (space after username)
  const detectMentionsWithTasks = (text: string): MentionMatch[] => {
    const mentions: MentionMatch[] = [];
    // Match @username followed by space and any content
    const mentionRegex = /@([a-zA-Z0-9_-]+)(\s+\S.*?)(?=\s@|\n|$)/g;
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push({
        start: match.index,
        end: match.index + match[0].length,
        username: match[1],
        fullMatch: match[0]
      });
    }

    return mentions;
  };

  // Render text with highlighted mentions
  const renderTextWithMentions = (text: string, showInlineHighlights: boolean = false) => {
    if (!text) {
      return (
        <span style={{ color: '#a0aec0' }}>
          {placeholder}
        </span>
      );
    }

    // Use task-aware detection when showing inline highlights
    const mentions = showInlineHighlights ? detectMentionsWithTasks(text) : detectMentions(text);
    if (mentions.length === 0) {
      return <span>{text}</span>;
    }

    const parts = [];
    let lastIndex = 0;

    mentions.forEach((mention, index) => {
      // Add text before mention
      if (mention.start > lastIndex) {
        parts.push(
          <span key={`text-${index}`}>
            {text.substring(lastIndex, mention.start)}
          </span>
        );
      }

      // Add highlighted mention
      parts.push(
        <span
          key={`mention-${index}`}
          style={{
            backgroundColor: '#dbeafe',
            color: '#1d4ed8',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '14px',
            fontWeight: '500',
            border: '1px solid #bfdbfe',
            display: 'inline-block',
            margin: '0 1px'
          }}
        >
          {showInlineHighlights ? `@${mention.username}` : mention.fullMatch}
        </span>
      );

      // Add task content after mention if showing inline highlights
      if (showInlineHighlights && mention.fullMatch.includes(' ')) {
        const taskContent = mention.fullMatch.substring(mention.username.length + 1);
        if (taskContent.trim()) {
          parts.push(
            <span key={`task-${index}`} style={{ marginLeft: '4px' }}>
              {taskContent}
            </span>
          );
        }
      }

      lastIndex = mention.end;
    });

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(
        <span key="text-end">
          {text.substring(lastIndex)}
        </span>
      );
    }

    return <>{parts}</>;
  };

  const handleFocus = () => {
    setIsEditing(true);
    onFocus?.();
  };

  const handleBlur = () => {
    setIsEditing(false);
    onBlur?.();
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setCursorPosition(e.target.selectionStart);
    onChange(newValue);
  };

  const handleDisplayClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsEditing(true);
    
    // Calculate approximate cursor position based on click location
    const clickX = e.clientX;
    const clickY = e.clientY;
    
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        
        // Try to position cursor near click location
        const textLength = value.length;
        const lines = value.split('\n');
        let estimatedPosition = 0;
        
        // Simple estimation - this could be improved with more sophisticated positioning
        if (clickY > textareaRef.current.offsetTop) {
          const lineHeight = 24; // approximate line height
          const clickedLine = Math.floor((clickY - textareaRef.current.offsetTop) / lineHeight);
          
          for (let i = 0; i < Math.min(clickedLine, lines.length - 1); i++) {
            estimatedPosition += lines[i].length + 1; // +1 for newline
          }
          
          if (clickedLine < lines.length) {
            const lineText = lines[clickedLine] || '';
            const charWidth = 8; // approximate character width
            const clickedChar = Math.floor((clickX - textareaRef.current.offsetLeft) / charWidth);
            estimatedPosition += Math.min(clickedChar, lineText.length);
          }
        }
        
        const finalPosition = Math.min(Math.max(0, estimatedPosition), textLength);
        textareaRef.current.setSelectionRange(finalPosition, finalPosition);
        setCursorPosition(finalPosition);
      }
    }, 0);
  };

  // Sync textarea height with display div
  useEffect(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      
      // Reset height to get accurate scrollHeight
      textarea.style.height = 'auto';
      textarea.style.height = Math.max(textarea.scrollHeight, 400) + 'px';
      
      // Ensure display div matches
      if (displayRef.current) {
        displayRef.current.style.height = textarea.style.height;
      }
    }
  }, [value, isEditing]);

  const baseStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '400px',
    border: 'none',
    outline: 'none',
    resize: 'none',
    fontSize: '16px',
    lineHeight: '1.6',
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    padding: '0',
    margin: '0',
    ...style
  };

  // Check if we should show inline highlights while typing
  const shouldShowInlineHighlights = isEditing && detectMentionsWithTasks(value).length > 0;

  return (
    <div style={{ position: 'relative', width: '100%', minHeight: '400px' }}>
      {/* Always visible textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleTextareaChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onSelect={(e) => {
          const target = e.target as HTMLTextAreaElement;
          setCursorPosition(target.selectionStart);
          if (onTextSelect && target.selectionStart !== target.selectionEnd) {
            const text = target.value.substring(target.selectionStart, target.selectionEnd).trim();
            if (text) {
              const rect = target.getBoundingClientRect();
              // Estimate position based on selection within textarea
              const lines = target.value.substring(0, target.selectionStart).split('\n');
              const lineHeight = 25.6; // 16px * 1.6
              const approxTop = rect.top + (lines.length - 1) * lineHeight;
              onTextSelect(text, { top: approxTop, left: rect.left, width: rect.width, height: lineHeight });
            }
          } else if (onTextSelect && target.selectionStart === target.selectionEnd) {
            onTextSelect('', { top: 0, left: 0, width: 0, height: 0 });
          }
        }}
        placeholder={placeholder}
        style={{
          ...baseStyle,
          color: (isEditing && !shouldShowInlineHighlights) ? '#2d3748' : 'transparent',
          caretColor: isEditing ? '#2d3748' : 'transparent',
          position: 'relative',
          zIndex: 2,
          backgroundColor: 'transparent',
          resize: 'vertical'
        }}
      />

      {/* Display div with highlighted mentions - show when not editing OR when editing with mentions */}
      {((isEditing && shouldShowInlineHighlights) || (!isEditing && value)) && (
        <div
          ref={displayRef}
          onClick={handleDisplayClick}
          style={{
            ...baseStyle,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1,
            cursor: 'text',
            color: '#4a5568',
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
            pointerEvents: isEditing ? 'none' : 'auto',
            padding: '0',
            margin: '0',
            overflow: 'hidden'
          }}
        >
          {renderTextWithMentions(value, shouldShowInlineHighlights)}
        </div>
      )}
    </div>
  );
};

export default MentionEditor;
