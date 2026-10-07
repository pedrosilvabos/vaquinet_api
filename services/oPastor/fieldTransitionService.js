import fieldTransitionContextService from './fieldTransitionContextService.js';

const fieldTransitionService = {
  async create(req, res) {
    try {
      const result = await fieldTransitionContextService.createFieldTransition({
        farmId: req.params.farmId?.trim(),
        animalIds: req.body?.animal_ids,
        fromFieldId: req.body?.from_field_id ?? null,
        toFieldId: req.body?.to_field_id,
        startedAt: req.body?.started_at ?? new Date(),
        createdBy: req.user?.id ?? null,
        metadata: req.body?.metadata ?? {},
      });
      return res.status(201).json(result);
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      console.error('[POST] Field transition failed', {
        farmId: req.params.farmId,
        error: error?.message ?? String(error),
      });
      return res.status(status).json({
        error: status === 500 ? 'field_transition_create_failed' : error.message,
      });
    }
  },
};

export default fieldTransitionService;
