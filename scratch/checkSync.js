const http = require('http');

function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  try {
    const token = 'jkW7vq5QInA4fhVr'; // From previous run
    const body = {
      transactions: [],
      settings: {},
      loans: [],
      savings: [
        {
          id: 'test-saving-id-123',
          keeperName: 'John Doe',
          amount: 5000,
          date: '2026-07-04',
          notes: 'Test savings entry',
          status: 'kept',
          updated_at: Date.now()
        }
      ]
    };

    console.log('Sending POST /api/sync...');
    const res = await post('http://localhost:3001/api/sync', {
      'Authorization': `Bearer ${token}`
    }, body);

    console.log('Response:', JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
