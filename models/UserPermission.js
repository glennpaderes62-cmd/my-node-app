const mongoose = require('mongoose');

const userPermissionSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    pageName: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'user_permissions',
  }
);

userPermissionSchema.index({ username: 1, pageName: 1 }, { unique: true });

module.exports = mongoose.model('UserPermission', userPermissionSchema);
