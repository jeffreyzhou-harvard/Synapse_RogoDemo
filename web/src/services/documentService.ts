export interface Document {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'published';
  tags?: string[];
}

class DocumentService {
  private static readonly STORAGE_KEY = 'midlayer_documents';

  // Get all documents
  static getAllDocuments(): Document[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error loading documents:', error);
      return [];
    }
  }

  // Get a single document by ID
  static getDocument(id: string): Document | null {
    const documents = this.getAllDocuments();
    return documents.find(doc => doc.id === id) || null;
  }

  // Save a new document or update existing one
  static saveDocument(document: Omit<Document, 'id' | 'createdAt' | 'updatedAt'>): Document {
    const documents = this.getAllDocuments();
    const now = new Date().toISOString();
    
    // Check if document already exists (for updates)
    const existingIndex = documents.findIndex(doc => 
      doc.title === document.title && doc.content === document.content
    );

    let savedDocument: Document;

    if (existingIndex !== -1) {
      // Update existing document
      savedDocument = {
        ...documents[existingIndex],
        ...document,
        updatedAt: now
      };
      documents[existingIndex] = savedDocument;
    } else {
      // Create new document
      savedDocument = {
        ...document,
        id: this.generateId(),
        createdAt: now,
        updatedAt: now
      };
      documents.push(savedDocument);
    }

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(documents));
      return savedDocument;
    } catch (error) {
      console.error('Error saving document:', error);
      throw new Error('Failed to save document');
    }
  }

  // Update existing document
  static updateDocument(id: string, updates: Partial<Omit<Document, 'id' | 'createdAt'>>): Document | null {
    const documents = this.getAllDocuments();
    const index = documents.findIndex(doc => doc.id === id);
    
    if (index === -1) {
      return null;
    }

    const updatedDocument = {
      ...documents[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };

    documents[index] = updatedDocument;

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(documents));
      return updatedDocument;
    } catch (error) {
      console.error('Error updating document:', error);
      throw new Error('Failed to update document');
    }
  }

  // Delete a document
  static deleteDocument(id: string): boolean {
    const documents = this.getAllDocuments();
    const filteredDocuments = documents.filter(doc => doc.id !== id);
    
    if (filteredDocuments.length === documents.length) {
      return false; // Document not found
    }

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filteredDocuments));
      return true;
    } catch (error) {
      console.error('Error deleting document:', error);
      throw new Error('Failed to delete document');
    }
  }

  // Get documents by status
  static getDocumentsByStatus(status: 'draft' | 'published'): Document[] {
    return this.getAllDocuments().filter(doc => doc.status === status);
  }

  // Search documents
  static searchDocuments(query: string): Document[] {
    const documents = this.getAllDocuments();
    const lowerQuery = query.toLowerCase();
    
    return documents.filter(doc => 
      doc.title.toLowerCase().includes(lowerQuery) ||
      doc.content.toLowerCase().includes(lowerQuery) ||
      (doc.tags && doc.tags.some(tag => tag.toLowerCase().includes(lowerQuery)))
    );
  }

  // Generate unique ID
  private static generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Clear all documents (for development/testing)
  static clearAllDocuments(): void {
    localStorage.removeItem(this.STORAGE_KEY);
  }

  // Export documents as JSON
  static exportDocuments(): string {
    const documents = this.getAllDocuments();
    return JSON.stringify(documents, null, 2);
  }

  // Import documents from JSON
  static importDocuments(jsonData: string): boolean {
    try {
      const documents = JSON.parse(jsonData);
      if (Array.isArray(documents)) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(documents));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error importing documents:', error);
      return false;
    }
  }
}

export default DocumentService;