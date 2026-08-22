import {Router} from 'express';
import { authenticateRequest, requirePermission } from '../../auth/http';
const router = Router();


router.get(
  "/",
  authenticateRequest(dependencies.authentication),
  requirePermission("users.manage"),
);
