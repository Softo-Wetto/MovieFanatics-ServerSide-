var express = require('express');
var router = express.Router();
const authorization = require("../middleware/authorization");

/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('index', { title: 'Swagger UI' });
});

// GET MOVIE SEARCH
router.get("/movies/search", async function (req, res, next) {
  const { title, year, page } = req.query;
  // Validate year format
  if (year && !/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: true, message: "Invalid year format. Format must be yyyy." });
  }
  // Validate page format
  if (page && isNaN(parseInt(page))) {
    return res.status(400).json({ error: true, message: "Invalid page format. page must be a number." });
  }
  const currentPage = parseInt(page) || 1;
  if (currentPage < 1) {
    return res.status(400).json({ error: true, message: "Invalid page format. Page must be a positive number." });
  }
  const perPage = 100;
  const from = (currentPage - 1) * perPage;
  try {
    // Query movies with filters
    let query = req.db.from('basics').select("primaryTitle", "year", "tconst", "imdbRating", "rottentomatoesRating", "metacriticRating", "rated");
    if (title) {
      query = query.where('primaryTitle', 'LIKE', `%${title}%`);
    }
    if (year) {
      query = query.where('year', '=', year);
    }
    // Count the total number of movies
    let countQuery = req.db.from('basics').count('tconst as count');
    if (title) {
      countQuery = countQuery.where('primaryTitle', 'LIKE', `%${title}%`);
    }
    if (year) {
      countQuery = countQuery.where('year', '=', year);
    }
    // Execute the main query and the count query in parallel
    const [rows, countRows] = await Promise.all([query.limit(perPage).offset(from), countQuery]);
    // Extract the data and count from the query results
    const data = rows.map((row) => ({
      title: row.primaryTitle,
      year: row.year,
      imdbID: row.tconst,
      imdbRating: parseFloat(row.imdbRating),
      rottenTomatoesRating: parseFloat(row.rottentomatoesRating),
      metacriticRating: parseFloat(row.metacriticRating),
      classification: row.rated
    }));
    const total = parseInt(countRows[0].count);
    const lastPage = Math.ceil(total / perPage);
    const response = {
      data,
      pagination: {
        total,
        lastPage,
        prevPage: currentPage > 1 ? currentPage - 1 : null,
        nextPage: currentPage < lastPage ? currentPage + 1 : null,
        perPage,
        currentPage,
        from,
        to: from + data.length
      }
    };
    res.json(response);
  } catch (err) {
    console.log(err);
    res.json({ "error": true, "message": "Error in MySQL query" });
  }
});


// GET MOVIE DATA
router.get("/movies/data/:imdbID", function (req, res, next) {
  const imdbID = req.params.imdbID;
  if (Object.keys(req.query).length > 0) {
    return res.status(400).json({ error: true, message: "Invalid query parameters: year. Query parameters are not permitted." });
  }
  req.db
    .from('basics')
    .select("primaryTitle", "year", "runtimeMinutes", "genres", "country", "boxoffice", "poster", "plot", "imdbRating", "rottentomatoesRating", "metacriticRating")
    .where('tconst', imdbID)
    .then((rows) => {
      if (rows.length === 0) {
        res.status(404).json({ "error": true, "message": "No record exists of a movie with this ID" });
      } else {
        // Retrieve the movie details from the database result
        const movie = {
          "title": rows[0].primaryTitle,
          "year": rows[0].year,
          "runtime": rows[0].runtimeMinutes,
          "genres": rows[0].genres.split(","),
          "country": rows[0].country,
          "principals": [],
          "ratings": [
            { source: "Internet Movie Database", value: parseFloat(rows[0].imdbRating) },
            { source: "Rotten Tomatoes", value: parseFloat(rows[0].rottentomatoesRating) },
            { source: "Metacritic", value: parseFloat(rows[0].metacriticRating) }
          ],
          "boxoffice": rows[0].boxoffice,
          "poster": rows[0].poster,
          "plot": rows[0].plot,
        };
        // Query the principals for the movie from the database
        req.db
          .from('principals')
          .select("nconst", "category", "name", "characters")
          .where('tconst', imdbID)
          .then((principals) => {
            movie.principals = principals.map((principal) => {
              return {
                id: principal.nconst,
                category: principal.category,
                name: principal.name,
                characters: principal.characters.length > 0 ? JSON.parse(principal.characters) : [],
              };
            });

            res.json(movie);
          })
          .catch((err) => {
            console.log(err);
            res.json({ "error": true, "message": "Error in MySQL query for principals" });
          });
      }
    })
    .catch((err) => {
      console.log(err);
      res.json({ "error": true, "message": "Error in MySQL query for movie details" });
    });
});



router.get("/people/:id", authorization, async function (req, res) {
  try {
    const { id } = req.params;

    // Fetch person data from MySQL based on id (nconst)
    const person = await req.db.from("names").select("*").where("nconst", "=", id).first();

    if (!person) {
      return res.status(404).json({ error: true, message: "No record exists of a person with this ID" });
    }

    const responseObj = {
      name: person.primaryName,
      birthYear: person.birthYear,
      deathYear: person.deathYear,
      roles: [],
    };

    if (Object.keys(req.query).length > 0) {
      return res.status(400).json({ error: true, message: "Invalid query parameters: year. Query parameters are not permitted." });
    }

    const roles = await req.db.from("principals").select("tconst", "category", "characters").where("nconst", "=", id);

    for (const role of roles) {
      const movie = await req.db.from("basics").select("tconst", "primaryTitle", "imdbRating").where("tconst", "=", role.tconst).first();

      if (movie) {
        // Prepare the role object
        const characters = JSON.parse(role.characters); // Convert characters string to array
        const roleObj = {
          movieName: movie.primaryTitle,
          movieId: movie.tconst,
          category: role.category,
          characters: characters,
          imdbRating: parseFloat(movie.imdbRating), // Parse the imdbRating as a float
        };
        responseObj.roles.push(roleObj);
      }
    }

    return res.status(200).json(responseObj);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: true, message: "Failed to fetch person data", details: error.message });
  }
});

module.exports = router;
