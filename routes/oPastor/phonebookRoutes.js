// File: routes/phonebookRoutes.js
import express from 'express';
import {
  getAllContacts,
  addContact,
  deleteContactById,
} from '../../services/oPastor/phonebookService.js';
import { requireBearerToken } from '../../middleware/auth.js';

const router = express.Router();

// list all contacts
router.get('/', getAllContacts);

// add new contact
router.post('/', requireBearerToken, addContact);

// delete by id (optional)
router.delete('/:id', requireBearerToken, deleteContactById);

export default router;
