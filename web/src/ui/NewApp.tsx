import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import SynapsePage from './SynapsePage';

const NewApp: React.FC = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<SynapsePage />} />
      </Routes>
    </Router>
  );
};

export default NewApp;