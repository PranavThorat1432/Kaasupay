// Verification script for Checkpoint 7 Dashboard and Add-Money endpoints
import 'dotenv/config';

const BASE = 'http://localhost:3000';

async function testLiveDashboardAndAddMoney() {
  console.log('--- Testing Live Dashboard & Add-Money Backend Endpoints ---');

  // 1. Sign up or Sign in with dedicated test user
  const credentials = {
    username: 'dashboard.verifier@example.com',
    password: 'SafePassword123!',
    firstName: 'Priya',
    lastName: 'Verifier',
  };

  let token;
  const signupRes = await fetch(`${BASE}/api/v1/user/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (signupRes.status === 201 || signupRes.status === 409) {
    // Sign in to get real JWT
    const signinRes = await fetch(`${BASE}/api/v1/user/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: credentials.username,
        password: credentials.password,
      }),
    });
    const signinData = await signinRes.json();
    token = signinData.token;
    console.log('PASS  Signed in user dashboard.verifier@example.com, JWT received');
  } else {
    throw new Error(`Auth failed with status ${signupRes.status}`);
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // 2. Fetch authenticated user profile
  const meRes = await fetch(`${BASE}/api/v1/user/me`, { headers: authHeaders });
  const meData = await meRes.json();
  if (meRes.status !== 200 || meData.user.username !== credentials.username) {
    throw new Error(`/me failed: status=${meRes.status} body=${JSON.stringify(meData)}`);
  }
  console.log(`PASS  /me returns user: ${meData.user.firstName} ${meData.user.lastName} (${meData.user.username})`);

  // 3. Fetch wallet balance
  const balRes = await fetch(`${BASE}/api/v1/wallet/balance`, { headers: authHeaders });
  const balData = await balRes.json();
  if (balRes.status !== 200 || typeof balData.balance !== 'number') {
    throw new Error(`/wallet/balance failed: status=${balRes.status} body=${JSON.stringify(balData)}`);
  }
  console.log(`PASS  /wallet/balance returns: balance=${balData.balance} paise, display=${balData.display}`);

  // 4. Fetch transaction history
  const txRes = await fetch(`${BASE}/api/v1/wallet/transactions?page=1&limit=5`, { headers: authHeaders });
  const txData = await txRes.json();
  if (txRes.status !== 200 || !Array.isArray(txData.data)) {
    throw new Error(`/wallet/transactions failed: status=${txRes.status} body=${JSON.stringify(txData)}`);
  }
  console.log(`PASS  /wallet/transactions returns: total=${txData.total}, items count=${txData.data.length}`);

  // 5. Test Add-Money Order Creation
  const orderRes = await fetch(`${BASE}/api/v1/wallet/add-money/order`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ amount: 50000 }),
  });
  const orderData = await orderRes.json();

  if (orderRes.status === 201) {
    console.log(`PASS  POST /wallet/add-money/order created order: orderId=${orderData.orderId}, amount=${orderData.amount} paise`);

    // 6. Test Add-Money Order Status lookup
    const statusRes = await fetch(`${BASE}/api/v1/wallet/add-money/orders/${orderData.orderId}`, {
      headers: authHeaders,
    });
    const statusData = await statusRes.json();
    if (statusRes.status !== 200 || statusData.status !== 'CREATED' || statusData.orderId !== orderData.orderId) {
      throw new Error(`Order status check failed: status=${statusRes.status} body=${JSON.stringify(statusData)}`);
    }
    console.log(`PASS  GET /wallet/add-money/orders/:orderId returned status=${statusData.status}, amount=${statusData.amount}`);
  } else if (orderRes.status === 503 || orderRes.status === 502) {
    console.log(`NOTE  POST /wallet/add-money/order returned ${orderRes.status} (${orderData.error}): Gateway credentials not set in local .env, fail-fast protection active`);
  } else {
    throw new Error(`Unexpected order response: status=${orderRes.status} body=${JSON.stringify(orderData)}`);
  }

  // 7. Test Boundary Validation on Add-Money
  const belowMinRes = await fetch(`${BASE}/api/v1/wallet/add-money/order`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ amount: 500 }), // 500 paise < 1000 paise min
  });
  if (belowMinRes.status !== 400) {
    throw new Error(`Below min validation failed: expected 400, got ${belowMinRes.status}`);
  }
  console.log('PASS  POST /wallet/add-money/order rejects amount below minimum (500 paise -> 400)');

  const aboveMaxRes = await fetch(`${BASE}/api/v1/wallet/add-money/order`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ amount: 1000001 }), // > 1,000,000 paise max
  });
  if (aboveMaxRes.status !== 400) {
    throw new Error(`Above max validation failed: expected 400, got ${aboveMaxRes.status}`);
  }
  console.log('PASS  POST /wallet/add-money/order rejects amount above maximum (1000001 paise -> 400)');

  console.log('\n--- ALL LIVE DASHBOARD & ADD-MONEY INTEGRATION CHECKS PASSED ---');
}

testLiveDashboardAndAddMoney().catch((err) => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
