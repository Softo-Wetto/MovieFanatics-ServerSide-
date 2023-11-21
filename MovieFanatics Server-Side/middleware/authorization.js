const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
  if (!("authorization" in req.headers) || !req.headers.authorization.match(/^Bearer /)) {
    return res.status(401).json({ error: true, message: "Authorization header ('Bearer token') not found" });
  }

  const token = req.headers.authorization.replace(/^Bearer /, "");
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Store the decoded user information in the request object
    next();
  } catch (e) {
    if (e.name === "TokenExpiredError") {
      return res.status(401).json({ error: true, message: "JWT token has expired" });
    } else if (e.name === "JsonWebTokenError") {
      return res.status(401).json({ error: true, message: "Invalid JWT token" });
    } else {
      return res.status(401).json({ error: true, message: "Authorization header is malformed" });
    }
  }
};

