import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fieldTransitionRoutes from '../routes/oPastor/fieldTransitionRoutes.js';

test('mounted field-transition route reaches auth middleware instead of Express 404', async () => {
  const app = express();
  app.use(express.json());
  // This is the effective production chain: app.use('/opastor', opastorRouter)
  // followed by opastorRouter.use('/farms', fieldTransitionRoutes).
  app.use('/opastor/farms', fieldTransitionRoutes);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/opastor/farms/farm-1/field-transitions`,
      { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } },
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Missing Bearer token' });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
