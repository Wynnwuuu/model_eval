/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import AppRouter from './app/router';
import PageMetadataSync from './components/PageMetadataSync';

export default function App() {
  return (
    <BrowserRouter>
      <PageMetadataSync />
      <AppRouter />
    </BrowserRouter>
  );
}
