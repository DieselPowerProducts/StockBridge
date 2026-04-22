const usersService = require("../services/users.service");

async function listUsers(req, res, next) {
  try {
    await usersService.registerAuthenticatedUser(req.user);
    const users = await usersService.listUsers();
    res.send(users);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listUsers
};
