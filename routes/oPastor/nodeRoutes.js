import express from "express";
import nodeService from "../../services/oPastor/nodeService.js";
import behaviorObservationService from "../../services/oPastor/behaviorObservationService.js";
import coverageService from "../../services/oPastor/coverageService.js";
import gpsConfigService from "../../services/oPastor/gpsConfigService.js";
import { batchTelemetry } from "../../services/oPastor/telemetryService.js";
import { requireBearerToken } from "../../middleware/auth.js";

const router = express.Router();

//router.get('/latest/:id',requireBearerToken, nodeService.getLatestNodeEventById);
// router.get('/', requireBearerToken, nodeService.getAllNodes);
// router.get('/:id/events', requireBearerToken, nodeService.getNodeEventsById);
// router.get('/:id', requireBearerToken, nodeService.getNodeById);
// router.put('/:id', requireBearerToken, nodeService.updateNode);
// router.delete('/:id', requireBearerToken, nodeService.deleteNode);

router.get("/latest/:id", nodeService.getLatestNodeEventById);
router.get("/", nodeService.getAllNodes);
router.get("/:id/events", nodeService.getNodeEventsById);
router.get("/:id/gps-config", gpsConfigService.getNodeGpsConfig);
router.get("/:id/coverage", coverageService.getNodeCoverage);
router.put(
  "/:id/gps-config",
  requireBearerToken,
  gpsConfigService.putNodeGpsConfig,
);
router.get("/:id/activity", nodeService.getNodeActivityById);
router.get("/:id/movement-timeline", nodeService.getNodeMovementTimelineById);
router.get("/:id/battery-timeline", nodeService.getNodeBatteryTimelineById);
router.get(
  "/:id/behavior-observations",
  behaviorObservationService.listObservations,
);
router.get(
  "/:id/behavior-observations/active",
  behaviorObservationService.getActiveObservation,
);
router.post(
  "/:id/behavior-observations/start",
  behaviorObservationService.startObservation,
);
router.post(
  "/:id/behavior-observations/stop",
  behaviorObservationService.stopObservation,
);
router.post(
  "/:id/behavior-observations/switch",
  behaviorObservationService.switchObservation,
);
router.post(
  "/:id/behavior-observations/cancel",
  behaviorObservationService.cancelObservation,
);
router.get("/:id", nodeService.getNodeById);
router.put("/:id", requireBearerToken, nodeService.updateNode);
router.delete("/:id", requireBearerToken, nodeService.deleteNode);

router.post("/", requireBearerToken, nodeService.createNode);
router.post("/batch", requireBearerToken, nodeService.batchInsertNodes);
router.post("/sensors", requireBearerToken, nodeService.processSensorData);
router.post("/telemetry/batch", requireBearerToken, batchTelemetry);

export default router;
