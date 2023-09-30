import express from 'express';
import { firebaseAuth } from '../middleware/authenticate_requests';
const router = express.Router();
const pdfController = require('../controllers/pdf_parsing');
// const multer = require('multer');

// const storage = multer.diskStorage({
//     destination: 'uploads/',
//     filename: (req: Request, file: any, cb: any) => {
//         cb(null, file.originalname);
//     }
// });

// const upload = multer({ storage });


router.post('/pdf-parser', firebaseAuth, pdfController.pdfParsing);
router.post('/pdf-query', firebaseAuth, pdfController.vectorQuerying);

module.exports = router;
