import { Response } from "express";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { PineconeClient } from "@pinecone-database/pinecone";
import * as dotenv from "dotenv";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { OpenAI } from "langchain/llms/openai";
import { PineconeStore } from "langchain/vectorstores/pinecone";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { CSVLoader } from "langchain/document_loaders/fs/csv";
import { db, storage } from "../firebase_config";
import { UserRequest } from "../middleware/authenticate_requests";
import { FieldValue } from "firebase-admin/firestore";
import { PromptTemplate } from "langchain";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const pdfParsing = async (req: UserRequest, res: Response) => {
  console.log(req.body);
  const fileName: string = req.body.fileName;
  console.log(fileName);
  const fileType: string = req.body.fileType;
  console.log(fileType);
  const uid: string = req.user.uid;
  console.log(uid);
  const chatId: string = req.body.chatId;
  console.log(chatId);
  const downloadUrl: string = req.body.downloadUrl;
  console.log(downloadUrl);

  const client = new PineconeClient();
  await client.init({
    apiKey: process.env.PINECONE_API_KEY!,
    environment: process.env.PINECONE_ENVIRONMENT!,
  });
  const pineconeIndex = client.Index(process.env.PINECONE_INDEX!);

  const bucket = storage.bucket(process.env.FIREBASE_STORAGE_BUCKET);
  const filePath = path.join(__dirname, "../uploads", fileName);
  const uploadsDir = path.join(__dirname, "../uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
  }
  const [file] = await bucket.file(`files/${fileName}`).download();
  fs.writeFileSync(filePath, file);
  let loader: any;
  let docs: any;
  try {
    console.log("starting");

    if (fileType === "application/pdf") {
      loader = new PDFLoader(filePath);
      docs = await loader?.load();
      docs.forEach((doc: any) => {
        doc.metadata.chatId = chatId;
        doc.metadata.uid = uid;
        doc.metadata.fileName = fileName;
      });
      console.log(docs);
    } else if (fileType === "text/plain") {
      loader = new TextLoader(filePath);
      docs = await loader?.load();
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 2000,
        chunkOverlap: 100,
      });
      docs = await splitter.splitDocuments(docs);
      docs.forEach((doc: any) => {
        doc.metadata.chatId = chatId;
        doc.metadata.uid = uid;
        doc.metadata.fileName = fileName;
      });
      console.log("this is the docs", docs);
    } else if (fileType === "text/csv") {
      loader = new CSVLoader(filePath);
      docs = await loader?.load();
      docs.forEach((doc: any) => {
        doc.metadata.chatId = chatId;
        doc.metadata.uid = uid;
        doc.metadata.fileName = fileName;
      });
      const combinedDocs = [];

      // Handle case when array length is less than 20
      if (docs.length < 20) {
        const pageContent = docs
          .map((doc: any) => {
            const lines = doc.pageContent.split("\n");
            lines.shift(); // Remove the first line with line number
            const updatedPageContent = lines.join("\n");
            return `${updatedPageContent}\nline: ${doc.metadata.line}`;
          })
          .join("\n");
        const metadata = { ...docs[0].metadata };
        delete metadata.line;
        const combinedDoc = { pageContent, metadata };
        combinedDocs.push(combinedDoc);
        return combinedDocs;
      }

      // Handle case when array length is not a multiple of 20
      const numFullGroups = Math.floor(docs.length / 20);
      const remainingDocs = docs.length % 20;

      for (let i = 0; i < numFullGroups; i++) {
        const startIndex = i * 20;
        const endIndex = startIndex + 20;
        const groupDocs = docs.slice(startIndex, endIndex);
        const pageContent = groupDocs
          .map((doc: any) => {
            const lines = doc.pageContent.split("\n");
            lines.shift(); // Remove the first line with line number
            const updatedPageContent = lines.join("\n");
            return `${updatedPageContent}\nline: ${doc.metadata.line}`;
          })
          .join("\n");
        const metadata = { ...groupDocs[0].metadata };
        delete metadata.line;
        const combinedDoc = { pageContent, metadata };
        combinedDocs.push(combinedDoc);
      }

      // Handle remaining documents
      if (remainingDocs > 0) {
        const startIndex = numFullGroups * 20;
        const remainingGroupDocs = docs.slice(startIndex);
        const pageContent = remainingGroupDocs
          .map((doc: any) => {
            const lines = doc.pageContent.split("\n");
            lines.shift(); // Remove the first line with line number
            const updatedPageContent = lines.join("\n");
            return `${updatedPageContent}\nline: ${doc.metadata.line}`;
          })
          .join("\n");
        const metadata = { ...remainingGroupDocs[0].metadata };
        delete metadata.line;
        const combinedDoc = { pageContent, metadata };
        combinedDocs.push(combinedDoc);
      }

      docs = combinedDocs;

      console.log(docs);
    } else if (fileType === "application/json") {
      try {
        // Parse the JSON data into an object
        const data = await fs.promises.readFile(filePath, "utf8");
        const jsonData = JSON.parse(data);

        // Convert the object back to text
        const textData = JSON.stringify(jsonData);

        console.log(textData);
        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 1000,
          chunkOverlap: 100,
        });
        docs = await splitter.createDocuments([textData]);
        docs.forEach((doc: any) => {
          doc.metadata.chatId = chatId;
          doc.metadata.uid = uid;
          doc.metadata.fileName = fileName;
        });
        console.log(docs);
        console.log("this is the docs", docs);
      } catch (error) {
        console.error("Error parsing JSON:", error);
      }
    } else {
      res.status(200).json("Unsupported format!");
    }

    if (docs.length == 0) {
      res.status(200).json("Unsupported file format!");
    }

    await PineconeStore.fromDocuments(
      docs!,
      new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
      }),
      {
        pineconeIndex,
      }
    );

    //adding to the list of pdfs the chat has
    const chatDocRef = db
      .collection("users")
      .doc(uid)
      .collection("chats")
      .doc(chatId);
    await chatDocRef.update({
      pdfs: FieldValue.arrayUnion(fileName),
    });

    fs.readdir("uploads", (err, files) => {
      if (err) throw err;

      for (const file of files) {
        fs.unlink(`uploads/${file}`, (err) => {
          if (err) throw err;
        });
      }
    });

    await bucket.file(`files/${fileName}`).delete();

    res.status(200).json("Uploaded successfully!");
  } catch (error) {
    console.log("this is the error", error);

    res.status(500).json(error);
  }
};

const vectorQuerying = async (req: UserRequest, res: Response) => {
  console.log(
    "these are the env variables :",
    process.env.PINECONE_API_KEY,
    process.env.PINECONE_ENVIRONMENT,
    process.env.PINECONE_INDEX
  );
  const uid = req.user.uid;
  console.log(uid);
  const chatId = req.body.chatId;
  console.log(chatId);
  const query = req.body.text;
  try {
    const client = new PineconeClient();
    await client.init({
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT,
    });
    const pineconeIndex = client.Index(process.env.PINECONE_INDEX);

    const vectorStore = await PineconeStore.fromExistingIndex(
      new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
      }),
      { pineconeIndex }
    );

    const results = await vectorStore.similaritySearch(query, 1, {
      chatId: chatId,
      uid: uid,
    });

    // console.log(results);
    if (
      results[0]?.pageContent === undefined ||
      results[0]?.pageContent === null
    ) {
      const response = "There are no files uploaded related to this question.";
      const fileName = "Unknown";
      const pageNumber = 0;
      const data = { response, fileName, pageNumber };
      res.status(200).json(data);
    }
    const doc = results[0].pageContent;
    console.log(doc);
    const fileName = results[0].metadata.fileName;
    const pageNumber = results[0].metadata["loc.pageNumber"];

    const newTemplate = PromptTemplate.fromTemplate(`
      "Search results: {doc}" \\
      "Using the search results, compose a concise and comprehensive answer to the query" \\
      "Query: {question}" \\
      "Answer: "
    `);

    const question = await newTemplate.format({
      doc: doc,
      question: query,
    });

    // console.log("this is the question", question);

    const model = new OpenAI({
      temperature: 0,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const response = await model.call(question);

    // console.log("this is the AI response: ", response);
    if (response.includes("I do not know")) {
      const fileName = "Unknown";
      const pageNumber = 0;
      const data = { response, fileName, pageNumber };
      res.status(200).json(data);
    } else {
      const data = { response, fileName, pageNumber };
      console.log(data);
      res.status(200).json(data);
    }
  } catch (error) {
    console.log(error);
    // res.status(500).send(error);
  }
};



module.exports = {
  pdfParsing,
  vectorQuerying,
};
