var express = require('express');
var router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const authorization = require('../middleware/authorization');

/* GET users listing. */
router.get('/', function (req, res, next) {
  res.send('respond with a resource');
});

router.post('/login', async function (req, res, next) {
  try {
    const { email, password, longExpiry, bearerExpiresInSeconds, refreshExpiresInSeconds } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        error: true,
        message: "Request body incomplete - email and password needed"
      });
    }
    // Determine if user already exists in the table
    const users = await req.db.from("users").select("*").where("email", "=", email);
    if (users.length === 0) {
      throw new Error("User does not exist");
    }
    const user = users[0];
    // Compare password hashes
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      throw new Error("Passwords do not match");
    }
    // Set token expiration based on input or default values
    const bearerExpiresIn = bearerExpiresInSeconds || 600;
    const refreshExpiresIn = refreshExpiresInSeconds || 86400;
    // Generate tokens
    const bearerToken = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: bearerExpiresIn });
    const refreshToken = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: refreshExpiresIn });
    const response = {
      bearerToken: {
        token: bearerToken,
        token_type: "Bearer",
        expires_in: bearerExpiresIn
      },
      refreshToken: {
        token: refreshToken,
        token_type: "Refresh",
        expires_in: refreshExpiresIn
      }
    };
    return res.status(200).json(response);
  } catch (error) {
    console.error(error);
    if (error.message === "User does not exist") {
      return res.status(401).json({ error: true, message: "Incorrect email or password" });
    } else {
      return res.status(401).json({ error: true, message: error.message });
    }
  }
});

router.post('/register', async function (req, res, next) {
  try {
    const { email, password } = req.body;
    // Verify body
    if (!email || !password) {
      return res.status(400).json({
        error: true,
        message: "Request body incomplete - both email and password are required"
      });
    }
    // Determine if user already exists in table
    const existingUser = await req.db.from("users").select("*").where("email", email).first();
    if (existingUser) {
      return res.status(409).json({
        error: true,
        message: "User already exists"
      });
    }
    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    // Insert user into DB
    const user = { email, password: hashedPassword };
    await req.db.from("users").insert(user);
    return res.status(201).json({ message: "User created" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: true, message: "Failed to register user" });
  }
});

router.post("/refresh", function (req, res, next) {
  try {
    const { refreshToken } = req.body;

    // Verify refresh token
    if (!refreshToken) {
      return res.status(400).json({
        error: true,
        message: "Request body incomplete, refresh token required"
      });
    }
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    // Generate new bearer token
    const bearerToken = jwt.sign({ email: decoded.email }, process.env.JWT_SECRET, { expiresIn: 600 });
    // Prepare response object
    const response = {
      bearerToken: {
        token: bearerToken,
        token_type: "Bearer",
        expires_in: 600
      },
      refreshToken: {
        token: refreshToken,
        token_type: "Refresh",
        expires_in: 86400
      }
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error(error);
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: true,
        message: "JWT token has expired"
      });
    } else {
      return res.status(401).json({
        error: true,
        message: "Invalid JWT token"
      });
    }
  }
});


router.post("/logout", function (req, res, next) {
  try {
    const { refreshToken } = req.body;
    // Verify refresh token
    if (!refreshToken) {
      return res.status(400).json({
        error: true,
        message: "Request body incomplete, refresh token required"
      });
    }
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    return res.status(200).json({
      error: false,
      message: "Token successfully invalidated"
    });
  } catch (error) {
    console.error(error);
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: true,
        message: "JWT token has expired"
      });
    } else {
      return res.status(401).json({
        error: true,
        message: "Invalid JWT token"
      });
    }
  }
});


router.get("/:email/profile", async function (req, res, next) {
  const email = req.params.email;
  const authorizationHead = req.headers.authorization;

  try {
    const userProfile = await req.db
      .from("users")
      .select("email", "firstName", "lastName", "dob", "address")
      .where("email", "=", email)
      .first();

    if (!userProfile) {
      return res.status(404).json({
        error: true,
        message: "User not found",
      });
    }

    if (authorizationHead && authorizationHead.startsWith("Bearer ")) {
      const access = authorizationHead.split(" ")[1];
      const decoded = jwt.verify(access, process.env.JWT_SECRET);

      if (decoded.email !== email) {
        delete userProfile.dob;
        delete userProfile.address;
      }
    } else {
      delete userProfile.dob;
      delete userProfile.address;
    }
    res.status(200).json(userProfile)
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: true, message: "Internal server error" });
  }
});


router.put("/:email/profile", authorization, async function (req, res, next) {
  const email = req.params.email;
  if (req.user && req.user.email === email) {
    try {
      const { firstName, lastName, dob, address } = req.body;

      if (!firstName || !lastName || !dob || !address) {
        return res.status(400).json({ error: true, message: "Request body incomplete: firstName, lastName, dob and address are required." });
      }
      if (typeof firstName !== "string" || typeof lastName !== "string" || typeof dob !== "string" || typeof address !== "string") {
        return res.status(400).json({ error: true, message: "Request body invalid: firstName, lastName and address must be strings only." });
      }
      if (!isValidDate(dob)) {
        return res.status(400).json({ error: true, message: "Invalid input: dob must be a real date in format YYYY-MM-DD." });
      }
      const currentDate = new Date();
      const inputDate = new Date(dob);
      if (inputDate > currentDate) {
        return res.status(400).json({ error: true, message: "Invalid input: dob must be a date in the past." });
      }

      await req.db.from("users").where("email", "=", email).update({
        firstName: firstName || null,
        lastName: lastName || null,
        dob: dob || null,
        address: address || null
      });

      const updatedProfile = await req.db.from("users").select("email", "firstName", "lastName", "dob", "address").where("email", "=", email).first();

      return res.status(200).json(updatedProfile);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: true, message: "Internal server error" });
    }
  } else if (req.user && req.user.email !== email) {
    return res.status(403).json({ error: true, message: "Forbidden" });
  } else {
    return res.status(401).json({ error: true, message: "Authorization header ('Bearer token') not found" });
  }
});

// Function to check if a date is valid in YYYY-MM-DD format
function isValidDate(dateString) {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) return false;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return false;
  const [year, month, day] = dateString.split("-").map(Number);
  return year === date.getFullYear() && month === date.getMonth() + 1 && day === date.getDate();
}

module.exports = router;