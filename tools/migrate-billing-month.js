import { db } from '../src/firebase-config.js';
import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { normalizeOrderForBilling } from '../src/orders/invoiceStats.js';

const run = async () => {
  const snap = await getDocs(collection(db, 'zlecenia'));
  const updates = [];
  snap.forEach((docSnap) => {
    const order = normalizeOrderForBilling({ id: docSnap.id, ...docSnap.data() });
    const payload = {
      billingMonth: order.billingMonth || null,
      createdOn: order.createdOn || null,
      completedOn: order.completedOn || null
    };
    updates.push(updateDoc(doc(db, 'zlecenia', docSnap.id), payload));
  });
  await Promise.all(updates);
  console.log(`Zmieniono ${updates.length} zleceń.`);
};

run().catch((err) => {
  console.error('Migration failed', err);
  process.exit(1);
});
