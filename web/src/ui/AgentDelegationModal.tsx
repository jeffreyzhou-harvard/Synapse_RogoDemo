import React, { useState } from 'react';
import agentService, { AgentDelegationResponse, FileChange } from '../services/agentService';

interface AgentDelegationModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedText: string;
  documentContext: string;
  taskDescription: string;
}

const AgentDelegationModal: React.FC<AgentDelegationModalProps> = ({
  isOpen,
  onClose,
  selectedText,
  documentContext,
  taskDescription
}) => {
  const [delegationResult, setDelegationResult] = useState<AgentDelegationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitSuccess, setCommitSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const handleDelegate = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await agentService.delegateToAgent({
        task_description: taskDescription,
        selected_text: selectedText,
        document_context: documentContext
      });
      
      if (result.error) {
        setError(result.error);
      } else {
        setDelegationResult(result);
        // Select all files by default
        setSelectedFiles(new Set(result.file_changes.map(f => f.path)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delegate to agent');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!delegationResult) return;
    
    setIsCommitting(true);
    setError(null);
    
    try {
      // Filter file changes to only include selected files
      const selectedFileChanges = delegationResult.file_changes.filter(
        change => selectedFiles.has(change.path)
      );
      
      const commitResult = await agentService.commitChanges({
        task_id: delegationResult.task_id,
        branch_name: delegationResult.branch_name,
        file_changes: selectedFileChanges,
        commit_message: delegationResult.commit_message
      });
      
      if (commitResult.error) {
        setError(commitResult.error);
      } else {
        setCommitSuccess(true);
        // Optionally create PR
        if (window.confirm('Changes committed successfully! Would you like to create a pull request?')) {
          await handleCreatePR();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to commit changes');
    } finally {
      setIsCommitting(false);
    }
  };

  const handleCreatePR = async () => {
    if (!delegationResult) return;
    
    try {
      const prResult = await agentService.createPullRequest({
        branch_name: delegationResult.branch_name,
        pr_title: delegationResult.pr_title,
        pr_description: delegationResult.pr_description
      });
      
      if (prResult.error) {
        setError(prResult.error);
      } else {
        window.open(prResult.pr_url, '_blank');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pull request');
    }
  };

  const toggleFileSelection = (filePath: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(filePath)) {
      newSelected.delete(filePath);
    } else {
      newSelected.add(filePath);
    }
    setSelectedFiles(newSelected);
  };

  const renderDiff = (fileChange: FileChange) => {
    const diff = agentService.generateDiffDisplay(fileChange);
    const lines = diff.split('\n');
    
    return (
      <div style={{ 
        fontFamily: 'Monaco, Consolas, monospace', 
        fontSize: '12px',
        backgroundColor: '#f8f9fa',
        border: '1px solid #e9ecef',
        borderRadius: '4px',
        padding: '12px',
        maxHeight: '300px',
        overflow: 'auto'
      }}>
        {lines.map((line, index) => {
          let backgroundColor = 'transparent';
          let color = '#333';
          
          if (line.startsWith('+')) {
            backgroundColor = '#d4edda';
            color = '#155724';
          } else if (line.startsWith('-')) {
            backgroundColor = '#f8d7da';
            color = '#721c24';
          }
          
          return (
            <div
              key={index}
              style={{
                backgroundColor,
                color,
                padding: '1px 4px',
                whiteSpace: 'pre-wrap'
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '24px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, color: '#2d3748' }}>Agent Code Delegation</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#718096'
            }}
          >
            ×
          </button>
        </div>

        {/* Task Description */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ color: '#4a5568', marginBottom: '8px' }}>Task Description</h3>
          <div style={{
            backgroundColor: '#f7fafc',
            padding: '12px',
            borderRadius: '4px',
            border: '1px solid #e2e8f0'
          }}>
            {taskDescription}
          </div>
        </div>



        {/* Error Display */}
        {error && (
          <div style={{
            backgroundColor: '#fed7d7',
            color: '#c53030',
            padding: '12px',
            borderRadius: '4px',
            marginBottom: '20px'
          }}>
            {error}
          </div>
        )}

        {/* Success Display */}
        {commitSuccess && (
          <div style={{
            backgroundColor: '#c6f6d5',
            color: '#2f855a',
            padding: '12px',
            borderRadius: '4px',
            marginBottom: '20px'
          }}>
            Changes committed successfully! 🎉
          </div>
        )}

        {/* Initial Delegation */}
        {!delegationResult && !isLoading && (
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={handleDelegate}
              style={{
                backgroundColor: '#4299e1',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '6px',
                fontSize: '16px',
                cursor: 'pointer',
                fontWeight: '500'
              }}
            >
              Delegate to Agent
            </button>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <div style={{ marginBottom: '16px' }}>🤖 Agent is analyzing and generating code...</div>
            <div style={{ color: '#718096' }}>This may take a few moments</div>
          </div>
        )}

        {/* Delegation Results */}
        {delegationResult && !commitSuccess && (
          <div>
            {/* Analysis */}
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ color: '#4a5568', marginBottom: '8px' }}>Agent Analysis</h3>
              <div style={{
                backgroundColor: '#f7fafc',
                padding: '12px',
                borderRadius: '4px',
                border: '1px solid #e2e8f0'
              }}>
                {delegationResult.analysis}
              </div>
            </div>

            {/* Commit Message */}
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ color: '#4a5568', marginBottom: '8px' }}>Commit Message</h3>
              <div style={{
                backgroundColor: '#f7fafc',
                padding: '12px',
                borderRadius: '4px',
                border: '1px solid #e2e8f0',
                fontFamily: 'Monaco, Consolas, monospace'
              }}>
                {delegationResult.commit_message}
              </div>
            </div>

            {/* File Changes */}
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ color: '#4a5568', marginBottom: '12px' }}>
                Proposed Changes ({delegationResult.file_changes.length} files)
              </h3>
              
              {delegationResult.file_changes.map((fileChange, index) => (
                <div key={index} style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  marginBottom: '16px',
                  overflow: 'hidden'
                }}>
                  {/* File Header */}
                  <div style={{
                    backgroundColor: '#f7fafc',
                    padding: '12px',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedFiles.has(fileChange.path)}
                        onChange={() => toggleFileSelection(fileChange.path)}
                        style={{ marginRight: '8px' }}
                      />
                      <span style={{ fontWeight: '600', marginRight: '8px' }}>
                        {fileChange.path}
                      </span>
                      <span style={{
                        backgroundColor: fileChange.action === 'create' ? '#c6f6d5' : 
                                       fileChange.action === 'update' ? '#bee3f8' : '#fed7d7',
                        color: fileChange.action === 'create' ? '#2f855a' : 
                               fileChange.action === 'update' ? '#2b6cb0' : '#c53030',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: '500'
                      }}>
                        {fileChange.action}
                      </span>
                    </div>
                  </div>
                  
                  {/* File Explanation */}
                  <div style={{ padding: '12px', backgroundColor: '#fafafa' }}>
                    <strong>Changes:</strong> {fileChange.explanation}
                  </div>
                  
                  {/* Diff Display */}
                  <div style={{ padding: '12px' }}>
                    {renderDiff(fileChange)}
                  </div>
                </div>
              ))}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{
                  backgroundColor: '#e2e8f0',
                  color: '#4a5568',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCommit}
                disabled={isCommitting || selectedFiles.size === 0}
                style={{
                  backgroundColor: selectedFiles.size === 0 ? '#cbd5e0' : '#48bb78',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '6px',
                  cursor: selectedFiles.size === 0 ? 'not-allowed' : 'pointer',
                  fontWeight: '500'
                }}
              >
                {isCommitting ? 'Committing...' : `Commit & Push (${selectedFiles.size} files)`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentDelegationModal;
