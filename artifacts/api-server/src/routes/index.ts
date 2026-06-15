import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ewaterRouter from "./ewater";
import monitorRouter from "./monitor";
import exportRouter from "./export";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ewaterRouter);
router.use(monitorRouter);
router.use(exportRouter);

export default router;
