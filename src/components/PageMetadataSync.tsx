import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { resolvePageMetadata } from '../pageMetadata';
import {
  applyPageMetadata,
  loadPageMetadataForLocation,
  PAGE_METADATA_REFRESH_EVENT,
} from '../pageMetadataClient';

const PageMetadataSync: React.FC = () => {
  const location = useLocation();
  const firstRun = useRef(true);
  const requestId = useRef(0);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener(PAGE_METADATA_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(PAGE_METADATA_REFRESH_EVENT, refresh);
  }, []);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    const initialRequest = firstRun.current;
    firstRun.current = false;

    if (!initialRequest) {
      applyPageMetadata(resolvePageMetadata({
        pathname: location.pathname,
        searchParams: new URLSearchParams(location.search),
      }));
    }

    loadPageMetadataForLocation(location.pathname, location.search)
      .then(metadata => {
        if (requestId.current === currentRequest) applyPageMetadata(metadata);
      })
      .catch(error => {
        console.warn('Failed to synchronize page metadata', error);
      });
  }, [location.pathname, location.search, revision]);

  return null;
};

export default PageMetadataSync;
