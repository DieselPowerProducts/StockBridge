const usersService = require("../services/users.service");

async function listUsers(req, res, next) {
  try {
    try {
      await usersService.registerAuthenticatedUser(req.user);
    } catch (error) {
      console.error("Unable to sync current user before listing users.", error);
    }

    const users = await usersService.listUsers();
    res.send(users);
  } catch (err) {
    try {
      res.send(usersService.getSeedUsers());
    } catch (fallbackError) {
      next(err);
    }
  }
}

module.exports = {
  listUsers
};
