import { Router } from 'express';

import { generationAssetService } from './generationAssetService.ts';

export const generationPublicAssetRoutes = Router();

generationPublicAssetRoutes.get('/:assetId/content', async (req, res) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const asset = await generationAssetService.verifyCapability(req.params.assetId, token);
    if (!asset) {
      res.status(404).json({ error: { code: 'ASSET_NOT_FOUND', message: 'Asset not found' } });
      return;
    }
    const signedUrl = await generationAssetService.signedGetUrl(asset.object_key);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.redirect(302, signedUrl);
  } catch (error) {
    res.status(500).json({
      error: {
        code: 'ASSET_REDIRECT_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
