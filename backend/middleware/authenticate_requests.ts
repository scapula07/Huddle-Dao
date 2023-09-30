import { auth } from "../firebase_config";
import { Request, Response } from "express";
export interface UserRequest extends Request {
  user: any;
}

export const firebaseAuth = (req: UserRequest, res: Response, next: any) => {
  const token = req.headers["authorization"].split(" ")[1];
  auth
    .verifyIdToken(token)
    .then((decodedToken) => {
      req.user = decodedToken;
      console.log('this is the user: ', req.user)
      next();
    })
    .catch((error) => {
      res.status(401).json({ error: "Unauthorized" });
    });
};
