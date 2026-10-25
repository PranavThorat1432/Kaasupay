import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import authService from '../../services/authService';
import { TOKEN_STORAGE_KEY, USER_STORAGE_KEY } from '../../services/api';

// Safe localStorage initialization
const getStoredToken = () => {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
};

const getStoredUser = () => {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const initialToken = getStoredToken();
const initialUser = getStoredUser();

export const loginUser = createAsyncThunk(
  'auth/loginUser',
  async (credentials, { rejectWithValue }) => {
    try {
      const data = await authService.signin(credentials);
      return data;
    } catch (err) {
      return rejectWithValue(err.message || 'Failed to sign in');
    }
  }
);

export const registerUser = createAsyncThunk(
  'auth/registerUser',
  async (userData, { rejectWithValue }) => {
    try {
      const data = await authService.signup(userData);
      return data;
    } catch (err) {
      return rejectWithValue(err.message || 'Failed to create account');
    }
  }
);

export const fetchCurrentUser = createAsyncThunk(
  'auth/fetchCurrentUser',
  async (_, { rejectWithValue }) => {
    try {
      const data = await authService.getMe();
      return data;
    } catch (err) {
      return rejectWithValue(err.message || 'Failed to fetch user profile');
    }
  }
);

export const updateUserProfile = createAsyncThunk(
  'auth/updateUserProfile',
  async (updates, { rejectWithValue }) => {
    try {
      const data = await authService.updateProfile(updates);
      return data;
    } catch (err) {
      return rejectWithValue(err.message || 'Failed to update profile');
    }
  }
);

export const logoutAllDevices = createAsyncThunk(
  'auth/logoutAllDevices',
  async (_, { dispatch, rejectWithValue }) => {
    try {
      await authService.logoutAll();
      dispatch(logout());
      return true;
    } catch (err) {
      dispatch(logout());
      return rejectWithValue(err.message || 'Failed to sign out of all devices');
    }
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    token: initialToken,
    user: initialUser,
    isAuthenticated: Boolean(initialToken),
    isLoading: false,
    error: null,
  },
  reducers: {
    setCredentials(state, action) {
      const { token, user } = action.payload;
      state.token = token;
      state.user = user;
      state.isAuthenticated = true;
      state.error = null;
      try {
        if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
        if (user) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
      } catch {
        // Ignore localStorage error
      }
    },
    setUserHasPin(state, action) {
      if (state.user) {
        state.user.hasPin = action.payload;
        try {
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(state.user));
        } catch {
          // Ignore storage error
        }
      }
    },
    logout(state) {
      state.token = null;
      state.user = null;
      state.isAuthenticated = false;
      state.error = null;
      try {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
      } catch {
        // Ignore localStorage error
      }
    },
    clearAuthError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Sign In
      .addCase(loginUser.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.isLoading = false;
        state.token = action.payload.token;
        state.isAuthenticated = true;
        state.error = null;
        try {
          localStorage.setItem(TOKEN_STORAGE_KEY, action.payload.token);
        } catch {
          // Ignore storage error
        }
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload;
      })

      // Sign Up
      .addCase(registerUser.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(registerUser.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload.user;
        state.error = null;
      })
      .addCase(registerUser.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload;
      })

      // Get Me
      .addCase(fetchCurrentUser.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        state.isLoading = false;
        const userData = action.payload.user || action.payload;
        state.user = userData;
        try {
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
        } catch {
          // Ignore storage error
        }
      })
      .addCase(fetchCurrentUser.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload;
      })

      // Update Profile (if password changed, backend supplies fresh JWT token)
      .addCase(updateUserProfile.fulfilled, (state, action) => {
        if (action.payload.user) {
          state.user = action.payload.user;
          try {
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(action.payload.user));
          } catch {
            // Ignore storage error
          }
        }
        if (action.payload.token) {
          state.token = action.payload.token;
          try {
            localStorage.setItem(TOKEN_STORAGE_KEY, action.payload.token);
          } catch {
            // Ignore storage error
          }
        }
      });
  },
});

export const { setCredentials, setUserHasPin, logout, clearAuthError } = authSlice.actions;
export default authSlice.reducer;
