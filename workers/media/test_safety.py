"""Tests for the tagger's decisions in safety.py, without the model.

Run from anywhere: python3 workers/media/test_safety.py (3.9 or newer). numpy
and Pillow are stubbed when they aren't installed, as the app's parity tests do:
the decisions need neither.
"""

from __future__ import annotations

import ast
import inspect
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

try:
    import numpy  # noqa: F401
except ImportError:
    sys.modules["numpy"] = types.ModuleType("numpy")
    sys.modules["numpy"].ndarray = object
try:
    from PIL import Image  # noqa: F401
except ImportError:
    _pil, _image = types.ModuleType("PIL"), types.ModuleType("PIL.Image")
    _image.Image = object
    _pil.Image = _image
    sys.modules.update({"PIL": _pil, "PIL.Image": _image})
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import safety  # noqa: E402

MINOR, PEOPLE = 0.3, 0.35
SOLO = {"1girl": 0.97, "solo": 0.93, "2girls": 0.03, "1boy": 0.04, "hetero": 0.02}


def refusal(*frames, people=PEOPLE):
    return safety.tag_refusal(list(frames), MINOR, people)


class PeopleCheck(unittest.TestCase):
    def test_passes_one_person(self):
        self.assertIsNone(refusal({"1girl": 0.98, "solo": 0.95, "2girls": 0.04, "hetero": 0.02, "1boy": 0.05}))
        self.assertIsNone(refusal({"1boy": 0.97, "solo": 0.9, "1girl": 0.1}))

    def test_refuses_a_group_tag(self):
        self.assertEqual(refusal({"1girl": 0.9, "2girls": 0.81}), "people:2girls:0.81")
        for tag in ("multiple_boys", "6+girls", "yuri", "threesome", "gangbang", "faceless_male", "disembodied_penis",
                    "pov_hands"):
            self.assertEqual(refusal({tag: 0.5}), f"people:{tag}:0.50", tag)

    def test_refuses_someone_elses_hand_by_family(self):
        for tag in ("hand_on_another's_head", "hand_on_another's_thigh", "grabbing_another's_breast",
                    "grabbing_another's_ass", "hand_on_another's_some_new_part", "hands_on_another's_shoulders",
                    "hands_on_another's_face", "holding_another's_wrist", "holding_another's_hair"):
            self.assertEqual(refusal({"1girl": 0.9, tag: 0.5}), f"people:{tag}:0.50", tag)
        # Her own hands, or the viewer's point of view alone, are one person.
        self.assertIsNone(refusal({"1girl": 0.9, "hand_on_own_chest": 0.9, "grabbing_own_breast": 0.9, "pov": 0.9,
                                   "hands_on_own_face": 0.9, "holding_own_hair": 0.9, "holding_sex_toy": 0.9}))
        self.assertIsNone(refusal({"1girl": 0.9, "hand_on_another's_head": 0.34}))
        self.assertIsNone(refusal({"1girl": 0.9, "holding_another's_wrist": 0.34}))

    def test_refuses_at_the_threshold_and_passes_below(self):
        self.assertEqual(refusal({"hetero": 0.35}), "people:hetero:0.35")
        self.assertIsNone(refusal({"hetero": 0.349}))

    def test_a_girl_and_a_boy_in_one_image_are_two_people(self):
        self.assertEqual(refusal({"1girl": 0.92, "1boy": 0.61}), "people:1girl+1boy:0.61")
        self.assertIsNone(refusal({"1girl": 0.92, "1boy": 0.3}))
        # One person read differently in two frames isn't a second person.
        self.assertIsNone(refusal({"1girl": 0.9, "1boy": 0.1}, {"1girl": 0.2, "1boy": 0.9}))

    def test_a_person_the_tagger_calls_neither_is_one_person_more(self):
        self.assertEqual(refusal({"1girl": 0.9, "1other": 0.5}), "people:1girl+1other:0.50")
        self.assertEqual(refusal({"1boy": 0.9, "1other": 0.4}), "people:1boy+1other:0.40")
        self.assertEqual(refusal({"1girl": 0.9, "1boy": 0.8, "1other": 0.7}),
                         "people:1girl+1boy:0.80, 1girl+1other:0.70, 1boy+1other:0.70")
        # Alone, "1other" is one person, as "1girl" and "1boy" are.
        self.assertIsNone(refusal({"1other": 0.9, "solo": 0.9}))
        self.assertIsNone(refusal({"1girl": 0.9, "1other": 0.34}))

    def test_lists_each_tag_once_at_its_highest_score(self):
        self.assertEqual(
            refusal({"2girls": 0.5, "1girl": 0.9, "1boy": 0.4}, {"2girls": 0.7, "hetero": 0.4},
                    {"1girl": 0.8, "1boy": 0.6, "hand_on_another's_hip": 0.5}),
            "people:2girls:0.70, hetero:0.40, hand_on_another's_hip:0.50, 1girl+1boy:0.60",
        )

    def test_a_childlike_tag_comes_first(self):
        self.assertEqual(refusal({"loli": 0.9, "2girls": 0.9}), "apparent minor: loli:0.90")
        self.assertEqual(refusal({"2girls": 0.9}, {"child": 0.4}), "apparent minor: child:0.40")
        self.assertIsNone(refusal({"loli": 0.29}))

    def test_implied_sex_alone_is_one_person(self):
        self.assertIsNone(refusal({"1girl": 0.95, "solo": 0.9, "implied_sex": 0.8}))

    def test_ignores_tags_the_tagger_doesnt_know(self):
        self.assertIsNone(refusal({}))
        self.assertIsNone(refusal({"1girl": 0.9}))

    def test_fails_closed_on_a_score_that_isnt_a_number(self):
        with self.assertRaises(ValueError):
            refusal({"1girl": 0.9, "2girls": float("nan")})

    def test_labels_what_was_checked(self):
        self.assertEqual(safety.label_refusal("apparent minor: loli:0.91", "frames"),
                         "apparent minor (frames): loli:0.91")
        self.assertEqual(safety.label_refusal("people:2girls:0.80, hetero:0.40", "source"),
                         "people (source):2girls:0.80, hetero:0.40")


class Clip(unittest.TestCase):
    """Several images are one clip's six sampled frames."""

    def test_one_frame_at_the_threshold_isnt_a_partner(self):
        self.assertIsNone(refusal(SOLO, SOLO, {**SOLO, "2girls": 0.5}, SOLO, SOLO, SOLO))
        self.assertIsNone(refusal(SOLO, {**SOLO, "1boy": 0.6}, SOLO, SOLO, SOLO, SOLO))
        self.assertIsNone(refusal(SOLO, SOLO, SOLO, SOLO, SOLO, {**SOLO, "hand_on_another's_head": 0.6}))

    def test_two_frames_with_a_second_person_are_refused(self):
        self.assertEqual(refusal(SOLO, {**SOLO, "2girls": 0.4}, {**SOLO, "2girls": 0.5}, SOLO, SOLO, SOLO),
                         "people:2girls:0.50")
        # Any check counts for its frame: the partner can be tagged differently in each.
        self.assertEqual(refusal(SOLO, SOLO, {**SOLO, "hetero": 0.4}, SOLO, {**SOLO, "1boy": 0.5}, SOLO),
                         "people:hetero:0.40, 1girl+1boy:0.50")

    def test_one_frame_well_above_the_threshold_is_refused(self):
        # Halfway from the threshold to 1: 0.675 at the default 0.35.
        self.assertEqual(refusal(SOLO, SOLO, SOLO, {**SOLO, "2girls": 0.68}, SOLO, SOLO), "people:2girls:0.68")
        self.assertIsNone(refusal(SOLO, SOLO, SOLO, {**SOLO, "2girls": 0.67}, SOLO, SOLO))
        self.assertEqual(refusal(SOLO, {**SOLO, "1boy": 0.9}, SOLO, SOLO, SOLO, SOLO), "people:1girl+1boy:0.90")
        # It moves with the threshold: 0.75 at 0.5.
        self.assertIsNone(refusal(SOLO, {**SOLO, "hetero": 0.74}, people=0.5))
        self.assertEqual(refusal(SOLO, {**SOLO, "hetero": 0.76}, people=0.5), "people:hetero:0.76")

    def test_one_frame_with_two_readings_is_refused(self):
        self.assertEqual(refusal(SOLO, SOLO, {**SOLO, "1boy": 0.4, "hetero": 0.4}, SOLO, SOLO, SOLO),
                         "people:hetero:0.40, 1girl+1boy:0.40")
        self.assertEqual(refusal(SOLO, {**SOLO, "2girls": 0.4, "yuri": 0.4}, SOLO, SOLO, SOLO, SOLO),
                         "people:2girls:0.40, yuri:0.40")
        self.assertEqual(refusal(SOLO, SOLO, SOLO, {**SOLO, "disembodied_penis": 0.4, "hetero": 0.5}, SOLO, SOLO),
                         "people:hetero:0.50, disembodied_penis:0.40")
        self.assertEqual(refusal(SOLO, {**SOLO, "hand_on_another's_hip": 0.4, "faceless_male": 0.4}, SOLO),
                         "people:faceless_male:0.40, hand_on_another's_hip:0.40")
        self.assertEqual(refusal(SOLO, {**SOLO, "2girls": 0.4, "threesome": 0.4}), "people:2girls:0.40, threesome:0.40")

    def test_one_frame_with_one_reading_in_several_tags_passes(self):
        # Danbooru implies "multiple_girls" from "2girls" and "group_sex" from
        # "threesome", so the tagger fires them together on one misread still.
        self.assertIsNone(refusal(SOLO, {**SOLO, "2girls": 0.5, "multiple_girls": 0.6}, SOLO, SOLO, SOLO, SOLO))
        self.assertIsNone(refusal(SOLO, {**SOLO, "2boys": 0.5, "multiple_boys": 0.5}, SOLO))
        self.assertIsNone(refusal(SOLO, {**SOLO, "threesome": 0.4, "group_sex": 0.5, "ffm_threesome": 0.4}, SOLO))
        # The pairs all come from 1girl, 1boy and 1other: one androgynous still.
        self.assertIsNone(refusal(SOLO, {**SOLO, "1boy": 0.5, "1other": 0.5}, SOLO, SOLO, SOLO, SOLO))
        # Her own two hands read as someone else's, in any family or as pov_hands.
        self.assertIsNone(refusal(SOLO, {**SOLO, "grabbing_another's_breast": 0.5, "hand_on_another's_head": 0.4,
                                         "hands_on_another's_face": 0.4, "holding_another's_hair": 0.4,
                                         "pov_hands": 0.4}, SOLO, SOLO, SOLO, SOLO))
        # A hand tag added to the block list later still reads as a hand.
        with mock.patch.object(safety, "_PEOPLE_BLOCK", [*safety._PEOPLE_BLOCK, "hand_in_another's_hair"]):
            self.assertEqual(safety._reading("hand_in_another's_hair"), "a hand")
            self.assertIsNone(refusal(SOLO, {**SOLO, "hand_in_another's_hair": 0.4, "hand_on_another's_head": 0.4}, SOLO))
        # A man alone in a cropped close-up.
        self.assertIsNone(refusal(SOLO, {**SOLO, "faceless_male": 0.5, "disembodied_penis": 0.5}, SOLO))
        # "6+girls" is a head count, not a pair.
        self.assertIsNone(refusal(SOLO, {**SOLO, "6+girls": 0.4, "multiple_girls": 0.4}, SOLO))

    def test_two_readings_in_different_frames_need_the_two_frame_rule(self):
        self.assertEqual(refusal(SOLO, {**SOLO, "hetero": 0.4}, {**SOLO, "2girls": 0.4}),
                         "people:2girls:0.40, hetero:0.40")
        # Below the threshold a tag isn't a reading at all.
        self.assertIsNone(refusal(SOLO, {**SOLO, "hetero": 0.4, "yuri": 0.34}, SOLO, SOLO, SOLO, SOLO))

    def test_one_picture_needs_only_the_threshold(self):
        self.assertEqual(refusal({**SOLO, "2girls": 0.5}), "people:2girls:0.50")

    def test_the_age_check_takes_any_one_frame(self):
        self.assertEqual(refusal(SOLO, SOLO, SOLO, SOLO, SOLO, {**SOLO, "loli": 0.31}), "apparent minor: loli:0.31")
        self.assertEqual(refusal(SOLO, {**SOLO, "child": 0.4, "2girls": 0.5}, SOLO), "apparent minor: child:0.40")


class NoSwitch(unittest.TestCase):
    """Nothing a caller sends turns a check off: a leaked key would send it."""

    def test_the_requests_have_no_field_for_it(self):
        tree = ast.parse(Path(__file__).with_name("app.py").read_text(encoding="utf-8"))
        fields = {node.name: {item.target.id for item in node.body if isinstance(item, ast.AnnAssign)}
                  for node in tree.body if isinstance(node, ast.ClassDef)}
        self.assertEqual(fields["ImageRequest"],
                         {"prompt", "negative_prompt", "width", "height", "seed", "lora", "style"})
        self.assertEqual(fields["VideoRequest"], {"job_id", "image", "image_mime_type", "prompt", "negative_prompt",
                                                  "seconds", "style", "callback_url"})

    def test_the_decision_has_no_opt_out(self):
        self.assertEqual(list(inspect.signature(safety.tag_refusal).parameters),
                         ["frames", "threshold", "people_threshold"])
        self.assertEqual(list(inspect.signature(safety.AnimeTagger.refusal).parameters), ["self", "images"])


class Watched(unittest.TestCase):
    def test_watches_only_what_the_tagger_knows(self):
        minor, people = safety.watched_tags([
            "1girl", "solo", "loli", "2girls", "hetero", "implied_sex", "pov", "pov_hands", "hand_on_own_chest",
            "hand_on_another's_head", "grabbing_another's_breast", "holding_another's_wrist",
            "hands_on_another's_shoulders", "holding_sex_toy", "hands_on_own_face",
        ])
        self.assertEqual(minor, ["loli"])
        self.assertEqual(people, ["2girls", "hetero", "pov_hands", "grabbing_another's_breast",
                                  "hand_on_another's_head", "hands_on_another's_shoulders",
                                  "holding_another's_wrist"])
        _, people = safety.watched_tags(["1girl", "1boy", "1other", "multiple_girls"])
        self.assertEqual(people, ["multiple_girls", "1girl+1boy", "1girl+1other", "1boy+1other"])
        _, people = safety.watched_tags(["1girl", "1boy"])
        self.assertEqual(people, ["1girl+1boy"])

    def test_scores_the_watched_tags_and_families(self):
        for tag in ("loli", "2girls", "pov_hands", "1other", "hand_on_another's_thigh", "grabbing_another's_ass",
                    "hands_on_another's_cheeks", "holding_another's_arm"):
            self.assertTrue(safety.is_watched(tag), tag)
        for tag in ("solo", "pov", "implied_sex", "hand_on_own_chest", "grabbing_own_breast", "another's_hand",
                    "hands_on_own_cheeks", "holding_own_arm", "holding_sex_toy", "holding_phone"):
            self.assertFalse(safety.is_watched(tag), tag)

    def test_names_what_the_tagger_doesnt_know(self):
        unknown = safety.unknown_tags(["1girl", "1boy", "loli", "2girls", "hand_on_another's_head"])
        for tag in ("shota", "1other", "pov_hands", "faceless_male", "grabbing_another's_*", "hands_on_another's_*",
                    "holding_another's_*"):
            self.assertIn(tag, unknown)
        for tag in ("1girl", "1boy", "loli", "2girls", "hand_on_another's_*"):
            self.assertNotIn(tag, unknown)
        # "hand_on_another's_" doesn't stand in for "hands_on_another's_", nor the other way round.
        unknown = safety.unknown_tags(["hands_on_another's_face", "holding_another's_wrist"])
        self.assertIn("hand_on_another's_*", unknown)
        self.assertNotIn("hands_on_another's_*", unknown)
        self.assertNotIn("holding_another's_*", unknown)

    def test_scores_map_the_model_output_to_tag_names(self):
        tags = ["general", "1girl", "1boy", "2girls", "loli", "solo", "hand_on_another's_hip", "hand_on_own_hip"]

        class Session:
            def get_inputs(self):
                return [types.SimpleNamespace(name="input", shape=[1, 448, 448, 3])]

            def get_outputs(self):
                return [types.SimpleNamespace(name="output")]

            def run(self, _outputs, feed):
                return [[feed["input"]]]

        tagger = safety.AnimeTagger("test/tagger", MINOR, PEOPLE)
        tagger._session, tagger._tags = Session(), tags
        tagger._watch = [i for i, name in enumerate(tags) if safety.is_watched(name)]
        tagger._prepare = lambda image: image  # The "image" is the model's output row.
        solo = [0.9, 0.95, 0.1, 0.05, 0.01, 0.9, 0.02, 0.8]
        couple = [0.9, 0.9, 0.8, 0.1, 0.01, 0.1, 0.6, 0.1]
        self.assertEqual(tagger.scores([solo]), [
            {"1girl": 0.95, "1boy": 0.1, "2girls": 0.05, "loli": 0.01, "hand_on_another's_hip": 0.02},
        ])
        self.assertIsNone(tagger.refusal([solo]))
        self.assertEqual(tagger.refusal([couple]), "people:hand_on_another's_hip:0.60, 1girl+1boy:0.80")
        # In a clip, one frame well above the threshold lists all it fired.
        self.assertEqual(tagger.refusal([solo, couple]), "people:hand_on_another's_hip:0.60, 1girl+1boy:0.80")
        self.assertIsNone(tagger.refusal([solo, solo]))


class FromEnv(unittest.TestCase):
    def test_reads_the_thresholds(self):
        with mock.patch.dict(os.environ, {"ANIME_TAGGER": "1"}, clear=True):
            tagger = safety.tagger_from_env()
            self.assertEqual((tagger.threshold, tagger.people_threshold), (0.3, 0.35))
        with mock.patch.dict(os.environ, {"PEOPLE_TAGGER_THRESHOLD": "0.5"}, clear=True):
            self.assertEqual(safety.tagger_from_env().people_threshold, 0.5)

    def test_refuses_a_threshold_that_switches_a_check_off(self):
        for value in ("0", "1", "1.5", "-0.2", "nan", "off"):
            with mock.patch.dict(os.environ, {"PEOPLE_TAGGER_THRESHOLD": value}, clear=True):
                with self.assertRaises(ValueError, msg=value):
                    safety.tagger_from_env()

    def test_anime_tagger_0_turns_off_both_checks(self):
        with mock.patch.dict(os.environ, {"ANIME_TAGGER": "0", "PEOPLE_TAGGER_THRESHOLD": "0.5"}, clear=True):
            self.assertIsNone(safety.tagger_from_env())


if __name__ == "__main__":
    unittest.main()
