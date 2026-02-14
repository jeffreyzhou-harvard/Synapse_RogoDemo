import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './HomePage';
import DocumentEditor from './DocumentEditor';

const NewApp: React.FC = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/editor" element={<DocumentEditor />} />
        <Route path="/editor/:id" element={<DocumentEditor />} />
      </Routes>
    </Router>
  );
};

export default NewApp;