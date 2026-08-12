const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3002';

/**
 * Wrapper for fetch that automatically injects the Splunk credentials 
 * from localStorage into the headers.
 */
export const apiFetch = async (endpoint, options = {}) => {
  const url = `${API_BASE}${endpoint}`;
  
  const headers = {
    ...options.headers,
  };

  // If we're sending JSON, make sure the content-type is set
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
     headers['Content-Type'] = 'application/json';
  }

  const credsStr = localStorage.getItem('splunkCreds');
  if (credsStr) {
    try {
      const creds = JSON.parse(credsStr);
      if (creds.host) headers['X-Splunk-Host'] = creds.host;
      if (creds.port) headers['X-Splunk-Port'] = creds.port;
      if (creds.username) headers['X-Splunk-Username'] = creds.username;
      if (creds.password) headers['X-Splunk-Password'] = creds.password;
      if (creds.hecToken) headers['X-Splunk-Hec-Token'] = creds.hecToken;
    } catch (e) {
      console.error('Failed to parse splunk creds', e);
    }
  }

  const res = await fetch(url, { ...options, headers });
  return res;
};
