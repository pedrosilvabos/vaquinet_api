// File: routes/phonebookRoutes.js
import express from 'express';
import {
  getAllContacts,
  addContact,
  deleteContactById,
} from '../../services/oPastor/phonebookService.js';

const router = express.Router();

// list all contacts
router.get('/', getAllContacts);

// add new contact
router.post('/', addContact);

// delete by id (optional)
router.delete('/:id', deleteContactById);

export default router;
