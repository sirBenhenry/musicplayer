"""Upgrade feature_vector from vector(128) to vector(1280) for EffnetDiscogs embeddings.

All existing vectors are cleared — songs will be re-analysed by the scheduler.

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-29
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    # Replace the 128-dim column with 1280-dim. All existing vectors are invalidated.
    op.execute("ALTER TABLE songs DROP COLUMN IF EXISTS feature_vector")
    op.execute("ALTER TABLE songs ADD COLUMN feature_vector vector(1280)")
    # Reset analysed_at so the scheduler re-queues every song for re-analysis.
    op.execute("UPDATE songs SET analysed_at = NULL")


def downgrade():
    op.execute("ALTER TABLE songs DROP COLUMN IF EXISTS feature_vector")
    op.execute("ALTER TABLE songs ADD COLUMN feature_vector vector(128)")
    op.execute("UPDATE songs SET analysed_at = NULL")
