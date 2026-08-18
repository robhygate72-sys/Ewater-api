import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ewaterRouter from "./ewater";
import hhcRouter from "./hhc";
import monitorRouter from "./monitor";
import exportRouter from "./export";
import notifierRouter from "./notifier";

const router: IRouter = Router();

router.use(healthRouter);
router.use(hhcRouter);
router.use(ewaterRouter);
router.use(monitorRouter);
router.use(exportRouter);
router.use(notifierRouter);

export default router;
