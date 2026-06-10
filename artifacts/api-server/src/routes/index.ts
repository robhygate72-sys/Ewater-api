import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ewaterRouter from "./ewater";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ewaterRouter);

export default router;
