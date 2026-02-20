import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import SynapsePage from './SynapsePage';
import ReportPage from './ReportPage';
import DocumentAuditPage from './DocumentAuditPage';

const NewApp: React.FC = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<SynapsePage />} />
        <Route path="/audit" element={<DocumentAuditPage />} />
        <Route path="/report/:reportId" element={<ReportPage />} />
      </Routes>
    </Router>
  );
};

export default NewApp;