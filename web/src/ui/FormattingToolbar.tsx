import React, { useState } from 'react';
import Icon from './Icon';

interface FormattingToolbarProps {
  onFormat?: (action: string, value?: string) => void;
}

const FormattingToolbar: React.FC<FormattingToolbarProps> = ({ onFormat }) => {
  const [showDropdown, setShowDropdown] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [activeButtons, setActiveButtons] = useState<Set<string>>(new Set());

  const toolbarStyles = {
    container: {
      display: 'flex' as const,
      alignItems: 'center' as const,
      gap: '4px',
      padding: '6px 8px',
      backgroundColor: 'white',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
      zIndex: 50,
      minHeight: '44px',
      marginBottom: '24px',
      width: 'fit-content',
    },
    group: {
      display: 'flex' as const,
      alignItems: 'center' as const,
      gap: '2px',
    },
    separator: {
      width: '1px',
      height: '20px',
      backgroundColor: '#e5e7eb',
      margin: '0 6px',
    },
  };

  const buttonStyles = {
    base: {
      width: '28px',
      height: '28px',
      border: 'none',
      backgroundColor: 'transparent',
      borderRadius: '4px',
      display: 'flex' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      cursor: 'pointer',
      color: '#6b7280',
      fontSize: '14px',
      transition: 'all 0.15s ease',
    },
  };

  const dropdownStyles = {
    container: {
      position: 'relative' as const,
      display: 'inline-block' as const,
    },
    trigger: {
      display: 'flex' as const,
      alignItems: 'center' as const,
      gap: '6px',
      padding: '4px 8px',
      height: '28px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      backgroundColor: 'white',
      cursor: 'pointer',
      fontSize: '13px',
      color: '#374151',
      transition: 'all 0.15s ease',
      minWidth: '80px',
      outline: 'none',
    },
    label: {
      flex: '1',
      textAlign: 'left' as const,
      fontWeight: '400',
    },
    chevron: {
      width: '12px',
      height: '12px',
      color: '#9ca3af',
    },
    menu: {
      position: 'absolute' as const,
      top: '100%',
      left: '0',
      right: '0',
      marginTop: '4px',
      backgroundColor: '#ffffff',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
      zIndex: 200,
      maxHeight: '200px',
      overflowY: 'auto' as const,
    },
    menuItem: {
      padding: '8px 12px',
      fontSize: '14px',
      color: '#374151',
      cursor: 'pointer',
      transition: 'background-color 0.15s ease',
    },
  };

  const handleButtonClick = (action: string, value?: string) => {
    if (onFormat) {
      onFormat(action, value);
    }
    
    // Toggle active state for formatting buttons
    if (['bold', 'italic', 'underline', 'strikethrough', 'code'].includes(action)) {
      const newActiveButtons = new Set(activeButtons);
      if (newActiveButtons.has(action)) {
        newActiveButtons.delete(action);
      } else {
        newActiveButtons.add(action);
      }
      setActiveButtons(newActiveButtons);
    }
  };

  const handleDropdownToggle = (dropdown: string) => {
    setShowDropdown(showDropdown === dropdown ? null : dropdown);
  };

  const getButtonStyle = (buttonName: string, extraStyles?: React.CSSProperties) => {
    const isActive = activeButtons.has(buttonName);
    return {
      ...buttonStyles.base,
      backgroundColor: isActive ? '#3b82f6' : 'transparent',
      color: isActive ? '#ffffff' : '#6b7280',
      ...extraStyles,
    };
  };

  const getDropdownTriggerStyle = (isOpen: boolean) => ({
    ...dropdownStyles.trigger,
    borderColor: isOpen ? '#3b82f6' : '#d1d5db',
    boxShadow: isOpen ? '0 0 0 2px rgba(59, 130, 246, 0.1)' : 'none',
  });

  const colors = [
    '#000000', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#f3f4f6', '#ffffff', '#fef2f2',
    '#dc2626', '#ea580c', '#d97706', '#ca8a04', '#65a30d', '#16a34a', '#059669', '#0891b2',
    '#0284c7', '#2563eb', '#4f46e5', '#7c3aed', '#a21caf', '#be185d', '#e11d48', '#f59e0b',
  ];

  return (
    <div style={toolbarStyles.container}>
      {/* Paragraph Dropdown */}
      <div style={toolbarStyles.group}>
        <div style={dropdownStyles.container}>
          <button
            style={getDropdownTriggerStyle(showDropdown === 'paragraph')}
            onClick={() => handleDropdownToggle('paragraph')}
          >
            <span style={dropdownStyles.label}>Paragraph</span>
            <Icon name="arrow-down" size={12} color="#9ca3af" />
          </button>
          {showDropdown === 'paragraph' && (
            <div style={dropdownStyles.menu}>
              {['Paragraph', 'Heading 1', 'Heading 2', 'Heading 3', 'Quote', 'Code Block'].map((option) => (
                <div
                  key={option}
                  style={dropdownStyles.menuItem}
                  onClick={() => {
                    handleButtonClick('format', option.toLowerCase().replace(' ', ''));
                    setShowDropdown(null);
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f3f4f6';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {option}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={toolbarStyles.separator} />

      {/* Text Formatting Group */}
      <div style={toolbarStyles.group}>
        <button
          style={getButtonStyle('bold', { fontWeight: '700' })}
          onClick={() => handleButtonClick('bold')}
          title="Bold"
          onMouseEnter={(e) => {
            if (!activeButtons.has('bold')) {
              e.currentTarget.style.backgroundColor = '#f3f4f6';
              e.currentTarget.style.color = '#374151';
            }
          }}
          onMouseLeave={(e) => {
            if (!activeButtons.has('bold')) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#6b7280';
            }
          }}
        >
          B
        </button>
        <button
          style={getButtonStyle('italic', { fontStyle: 'italic' })}
          onClick={() => handleButtonClick('italic')}
          title="Italic"
          onMouseEnter={(e) => {
            if (!activeButtons.has('italic')) {
              e.currentTarget.style.backgroundColor = '#f3f4f6';
              e.currentTarget.style.color = '#374151';
            }
          }}
          onMouseLeave={(e) => {
            if (!activeButtons.has('italic')) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#6b7280';
            }
          }}
        >
          I
        </button>
        <button
          style={getButtonStyle('underline', { textDecoration: 'underline' })}
          onClick={() => handleButtonClick('underline')}
          title="Underline"
          onMouseEnter={(e) => {
            if (!activeButtons.has('underline')) {
              e.currentTarget.style.backgroundColor = '#f3f4f6';
              e.currentTarget.style.color = '#374151';
            }
          }}
          onMouseLeave={(e) => {
            if (!activeButtons.has('underline')) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#6b7280';
            }
          }}
        >
          U
        </button>
      </div>

      <div style={toolbarStyles.separator} />

      {/* Tools Group */}
      <div style={toolbarStyles.group}>
        <button
          style={buttonStyles.base}
          onClick={() => handleButtonClick('link')}
          title="Link"
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f3f4f6';
            e.currentTarget.style.color = '#374151';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = '#6b7280';
          }}
        >
          <Icon name="link" size={14} />
        </button>
        <button
          style={getButtonStyle('code')}
          onClick={() => handleButtonClick('code')}
          title="Code"
          onMouseEnter={(e) => {
            if (!activeButtons.has('code')) {
              e.currentTarget.style.backgroundColor = '#f3f4f6';
              e.currentTarget.style.color = '#374151';
            }
          }}
          onMouseLeave={(e) => {
            if (!activeButtons.has('code')) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#6b7280';
            }
          }}
        >
          <Icon name="code" size={14} />
        </button>
      </div>

      <div style={toolbarStyles.separator} />

      {/* Insert Group */}
      <div style={toolbarStyles.group}>
        <button
          style={{
            ...dropdownStyles.trigger,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          onClick={() => handleDropdownToggle('insert')}
          title="Insert"
        >
          <Icon name="plus" size={12} />
          <span style={dropdownStyles.label}>Insert</span>
          <Icon name="arrow-down" size={12} color="#9ca3af" />
        </button>
        {showDropdown === 'insert' && (
          <div style={dropdownStyles.menu}>
            {['Image', 'Link', 'Table', 'Divider'].map((option) => (
              <div
                key={option}
                style={dropdownStyles.menuItem}
                onClick={() => {
                  handleButtonClick('insert', option.toLowerCase());
                  setShowDropdown(null);
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f3f4f6';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {option}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={toolbarStyles.separator} />

      {/* More Actions */}
      <div style={toolbarStyles.group}>
        <button
          style={buttonStyles.base}
          onClick={() => handleButtonClick('comment')}
          title="Comment"
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f3f4f6';
            e.currentTarget.style.color = '#374151';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = '#6b7280';
          }}
        >
          <Icon name="comment" size={14} />
        </button>
        <button
          style={buttonStyles.base}
          onClick={() => handleButtonClick('more')}
          title="More"
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f3f4f6';
            e.currentTarget.style.color = '#374151';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = '#6b7280';
          }}
        >
          <Icon name="more" size={14} />
        </button>
      </div>
    </div>
  );
};

export default FormattingToolbar;