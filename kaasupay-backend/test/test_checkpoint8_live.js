// Live Verification Script for Checkpoint 8
// Verifies live P2P transfer, balance conservation, idempotency replay, and ledger history.

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const ADMIN_KEY = process.env.ADMIN_KEY || 'kaasupay_admin_1432';

async function main() {
  console.log('=== Starting Checkpoint 8 Live P2P & Ledger Verification ===');
  console.log(`Target server: ${BASE_URL}\n`);

  const ts = Date.now();
  const userA = {
    username: `live_sender_${ts}@example.com`,
    password: 'Password@123',
    firstName: 'Arun',
    lastName: 'Kumar',
  };

  const userB = {
    username: `live_recipient_${ts}@example.com`,
    password: 'Password@123',
    firstName: 'Deepa',
    lastName: 'Sharma',
  };

  // 1. Sign up User A (Sender) and sign in
  console.log('1. Registering disposable User A (Sender)...');
  const resSignupA = await fetch(`${BASE_URL}/api/v1/user/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userA),
  });
  if (resSignupA.status !== 201) {
    throw new Error(`Failed to signup User A: ${resSignupA.status} ${await resSignupA.text()}`);
  }
  const resSigninA = await fetch(`${BASE_URL}/api/v1/user/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: userA.username, password: userA.password }),
  });
  if (resSigninA.status !== 200) {
    throw new Error(`Failed to signin User A: ${resSigninA.status} ${await resSigninA.text()}`);
  }
  const dataSigninA = await resSigninA.json();
  const tokenA = dataSigninA.token;
  console.log(`   ✓ User A created & signed in: ${userA.username} (_id: ${dataSigninA.user?._id})`);

  // 2. Sign up User B (Recipient) and sign in
  console.log('2. Registering disposable User B (Recipient)...');
  const resSignupB = await fetch(`${BASE_URL}/api/v1/user/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userB),
  });
  if (resSignupB.status !== 201) {
    throw new Error(`Failed to signup User B: ${resSignupB.status} ${await resSignupB.text()}`);
  }
  const resSigninB = await fetch(`${BASE_URL}/api/v1/user/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: userB.username, password: userB.password }),
  });
  if (resSigninB.status !== 200) {
    throw new Error(`Failed to signin User B: ${resSigninB.status} ${await resSigninB.text()}`);
  }
  const dataSigninB = await resSigninB.json();
  const tokenB = dataSigninB.token;
  console.log(`   ✓ User B created & signed in: ${userB.username} (_id: ${dataSigninB.user?._id})`);

  // 3. Test Live Recipient Search Autocomplete (GET /api/v1/user/bulk?filter=deepa)
  console.log('3. Testing recipient autocomplete search as User A...');
  const resSearch = await fetch(`${BASE_URL}/api/v1/user/bulk?filter=deepa`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  if (resSearch.status !== 200) {
    throw new Error(`Search failed: ${resSearch.status} ${await resSearch.text()}`);
  }
  const searchData = await resSearch.json();
  const foundUserB = (searchData.users || []).find(
    (u) => u.username.toLowerCase() === userB.username.toLowerCase()
  );
  if (!foundUserB) {
    throw new Error(`Recipient User B not found in autocomplete search! Found: ${JSON.stringify(searchData.users)}`);
  }
  if (foundUserB.password || foundUserB.passwordHash) {
    throw new Error('Security violation: password hash leaked in search results!');
  }
  console.log(`   ✓ Recipient autocomplete found User B: ${foundUserB.firstName} ${foundUserB.lastName} (${foundUserB.username}) without password leaks`);

  // 4. Fund User A with initial balance via staff deposit (50,000 paise = ₹500.00)
  console.log('4. Funding User A with ₹500 (50,000 paise) via staff deposit...');
  const resDeposit = await fetch(`${BASE_URL}/api/v1/admin/deposit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': ADMIN_KEY,
    },
    body: JSON.stringify({
      to: userA.username,
      amount: 50000,
      note: 'Initial test funding',
    }),
  });
  if (resDeposit.status !== 201) {
    throw new Error(`Deposit failed: ${resDeposit.status} ${await resDeposit.text()}`);
  }
  console.log('   ✓ Staff deposit credited 50,000 paise to User A');

  // Verify Initial Balances
  const getBal = async (token) => {
    const r = await fetch(`${BASE_URL}/api/v1/wallet/balance`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return (await r.json()).balance;
  };

  const initialBalA = await getBal(tokenA);
  const initialBalB = await getBal(tokenB);
  console.log(`   Initial Balances -> User A: ₹${initialBalA / 100} (${initialBalA} paise), User B: ₹${initialBalB / 100} (${initialBalB} paise)`);
  if (initialBalA !== 50000 || initialBalB !== 0) {
    throw new Error(`Initial balances unexpected: A=${initialBalA}, B=${initialBalB}`);
  }

  // 5. Execute P2P Transfer from User A to User B: 15,000 paise (₹150.00)
  const transferAmount = 15000;
  const idempotencyKey = `chk8-live-${ts}-${Math.random().toString(36).substring(2, 9)}`;
  const transferPayload = {
    to: userB.username,
    amount: transferAmount,
    note: 'Dinner contribution Checkpoint 8',
  };

  console.log(`5. Executing live P2P transfer: ₹${transferAmount / 100} (${transferAmount} paise) to ${userB.username}...`);
  console.log(`   Using Idempotency-Key: ${idempotencyKey}`);

  const resTransfer1 = await fetch(`${BASE_URL}/api/v1/wallet/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(transferPayload),
  });

  if (resTransfer1.status !== 201) {
    throw new Error(`Transfer failed: ${resTransfer1.status} ${await resTransfer1.text()}`);
  }
  const transferData1 = await resTransfer1.json();
  const txId1 = transferData1.transactionId || transferData1.transaction?._id;
  console.log(`   ✓ Transfer successful! Status: ${resTransfer1.status}, Transaction ID: ${txId1}`);

  // 6. Verify Balances and Money Conservation
  console.log('6. Verifying balances and financial conservation...');
  const postBalA = await getBal(tokenA);
  const postBalB = await getBal(tokenB);
  console.log(`   Post-transfer Balances -> User A: ₹${postBalA / 100} (${postBalA} paise), User B: ₹${postBalB / 100} (${postBalB} paise)`);

  const senderDebit = initialBalA - postBalA;
  const recipientCredit = postBalB - initialBalB;

  console.log(`   Sender Debit: ${senderDebit} paise | Recipient Credit: ${recipientCredit} paise`);
  if (senderDebit !== transferAmount) {
    throw new Error(`Sender debit (${senderDebit}) does not equal transfer amount (${transferAmount})!`);
  }
  if (recipientCredit !== transferAmount) {
    throw new Error(`Recipient credit (${recipientCredit}) does not equal transfer amount (${transferAmount})!`);
  }
  if (senderDebit !== recipientCredit) {
    throw new Error(`Debit (${senderDebit}) != Credit (${recipientCredit})! Conservation violated!`);
  }

  const initialTotal = initialBalA + initialBalB;
  const postTotal = postBalA + postBalB;
  if (initialTotal !== postTotal) {
    throw new Error(`Total money changed from ${initialTotal} to ${postTotal}! Invariant broken!`);
  }
  console.log(`   ✓ Exact Balance Conservation Confirmed: Debit (${senderDebit}p) === Credit (${recipientCredit}p). Total wallet balance conserved (${postTotal}p).`);

  // 7. Repeated-Request / Idempotency Replay Verification
  console.log('7. Testing Repeated-Request / Idempotency Replay Safety...');
  const resTransfer2 = await fetch(`${BASE_URL}/api/v1/wallet/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
      'Idempotency-Key': idempotencyKey, // EXACT SAME KEY
    },
    body: JSON.stringify(transferPayload),
  });

  if (resTransfer2.status !== 201) {
    throw new Error(`Replay request failed with unexpected status: ${resTransfer2.status}`);
  }
  const transferData2 = await resTransfer2.json();
  const txId2 = transferData2.transactionId || transferData2.transaction?._id;
  if (txId1 !== txId2) {
    throw new Error(`Replay returned different transaction ID: ${txId1} vs ${txId2}`);
  }

  // Check balances after replay attempt
  const replayBalA = await getBal(tokenA);
  const replayBalB = await getBal(tokenB);
  console.log(`   Balances after replay -> User A: ₹${replayBalA / 100} (${replayBalA}p), User B: ₹${replayBalB / 100} (${replayBalB}p)`);

  if (replayBalA !== postBalA || replayBalB !== postBalB) {
    throw new Error(`Double debit occurred on idempotent replay! A went from ${postBalA} to ${replayBalA}`);
  }
  console.log('   ✓ Idempotency Replay Verified: Server returned cached 201 response with matching Transaction ID, and zero double debits occurred.');

  // 8. Transaction Ledger History Verification
  console.log('8. Verifying Transaction Ledger History...');
  // User A's history
  const resHistA = await fetch(`${BASE_URL}/api/v1/wallet/transactions?page=1&limit=10`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  if (resHistA.status !== 200) {
    throw new Error(`Failed to fetch history for User A: ${resHistA.status}`);
  }
  const histA = await resHistA.json();
  const txListA = histA.data || [];
  console.log(`   User A history count: ${txListA.length} (total: ${histA.total})`);

  const userADebitTx = txListA.find((t) => t.direction === 'DEBIT');
  if (!userADebitTx) {
    throw new Error('User A does not have a DEBIT transaction entry in history!');
  }
  if (userADebitTx.amount !== transferAmount) {
    throw new Error(`User A DEBIT amount mismatch: expected ${transferAmount}, got ${userADebitTx.amount}`);
  }
  if (userADebitTx.balanceAfter !== postBalA) {
    throw new Error(`User A balanceAfter mismatch: expected ${postBalA}, got ${userADebitTx.balanceAfter}`);
  }
  console.log(`   ✓ User A DEBIT entry verified: amount: ₹${userADebitTx.amount / 100}, counterparty: "${userADebitTx.withWhom}", balanceAfter: ₹${userADebitTx.balanceAfter / 100}`);

  // User B's history
  const resHistB = await fetch(`${BASE_URL}/api/v1/wallet/transactions?page=1&limit=10`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  if (resHistB.status !== 200) {
    throw new Error(`Failed to fetch history for User B: ${resHistB.status}`);
  }
  const histB = await resHistB.json();
  const txListB = histB.data || [];
  console.log(`   User B history count: ${txListB.length} (total: ${histB.total})`);

  const userBCreditTx = txListB.find((t) => t.direction === 'CREDIT');
  if (!userBCreditTx) {
    throw new Error('User B does not have a CREDIT transaction entry in history!');
  }
  if (userBCreditTx.amount !== transferAmount) {
    throw new Error(`User B CREDIT amount mismatch: expected ${transferAmount}, got ${userBCreditTx.amount}`);
  }
  if (userBCreditTx.balanceAfter !== postBalB) {
    throw new Error(`User B balanceAfter mismatch: expected ${postBalB}, got ${userBCreditTx.balanceAfter}`);
  }
  console.log(`   ✓ User B CREDIT entry verified: amount: ₹${userBCreditTx.amount / 100}, counterparty: "${userBCreditTx.withWhom}", balanceAfter: ₹${userBCreditTx.balanceAfter / 100}`);

  console.log('\n=== ALL CHECKPOINT 8 LIVE VERIFICATIONS PASSED SUCCESSFULLY ===');
}

main().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
