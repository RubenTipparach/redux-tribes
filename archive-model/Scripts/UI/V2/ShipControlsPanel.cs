using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public enum ControlsSelection {
    RotateTo,
    Move,
    Weapons,
    None
}
public class ShipControlsPanel : MonoBehaviour
{

    public Sprite rotateTo_U;
    public Sprite rotateTo_S;

    public Sprite move_U;
    public Sprite move_S;

    public Sprite weapon_U;
    public Sprite weapon_S;

    public Button rotateTo_Button;
    public Button moveTo_Button;
    public Button weapons_Button;

    public ControlsSelection buttonSelection;

    public GameObject weaponsPanel;
    public GameObject technicalPanel;
    public GameObject movementPanel;

    public bool moveModeSelected = false;

    public NavButtons navButtons;

    // Start is called before the first frame update
    void Start()
    {
        buttonSelection = ControlsSelection.None;
        SetSelection();

        rotateTo_Button.onClick.AddListener(() =>
        {
            SetRotateToMenu();
        });

        moveTo_Button.onClick.AddListener(() =>
        {
            SetMoveMenu(moveModeSelected);
        });

        weapons_Button.onClick.AddListener(() =>
        {
            SetWeaponsMenu();
        });

        navButtons.Setup();
    }

    /*
     todo add manuever shortcuts like:
     - rotate to enemy ship
     - rotate away from,
     - broad side left, right
     - snap to galactic plane
     - manever directly up
     - manuever directly down
     */
    public void SetRotateToMenu()
    {
        GameManager.Instance.uiManagerV2.ConfirmMoveMode();
        buttonSelection = ControlsSelection.RotateTo;
        SetSelection();
        moveModeSelected = false;
    }

    public void SetMoveMenu(bool moveMode)
    {
        if (moveMode)
        {
            GameManager.Instance.uiManagerV2.ConfirmMoveMode();
            moveModeSelected = false;
            buttonSelection = ControlsSelection.None;
            SetSelection();

        }
        else
        {
            GameManager.Instance.uiManagerV2.EnterMovementMode();
            buttonSelection = ControlsSelection.Move;
            SetSelection();
            moveModeSelected = true;
        }
    }

    public void SetWeaponsMenu()
    {
        GameManager.Instance.uiManagerV2.ConfirmMoveMode();
        buttonSelection = ControlsSelection.Weapons;
        SetSelection();
        moveModeSelected = false;
    }

    private void SetSelection()
    {
        rotateTo_Button.image.sprite = rotateTo_S;
        moveTo_Button.image.sprite = move_S;
        weapons_Button.image.sprite = weapon_S;
        weaponsPanel.SetActive(false);
        movementPanel.SetActive(false);
        technicalPanel.SetActive(false);
        switch (buttonSelection)
        {
            case ControlsSelection.RotateTo:
                rotateTo_Button.image.sprite = rotateTo_U;
                technicalPanel.SetActive(true);
                break;
            case ControlsSelection.Move:
                moveTo_Button.image.sprite = move_U;
                movementPanel.SetActive(true);
                break;
            case ControlsSelection.Weapons:
                weapons_Button.image.sprite = weapon_U;
                weaponsPanel.SetActive(true);
                break;
            case ControlsSelection.None:
                break;
        }
    }

    // Update is called once per frame
    void Update()
    {

    }

    public void CheckControls()
    {
        if (Input.GetKeyDown(KeyCode.T))
        {
            rotateTo_Button.onClick.Invoke();
        }

        if (Input.GetKeyDown(KeyCode.Y))
        {
            moveTo_Button.onClick.Invoke();
        }

        if (Input.GetKeyDown(KeyCode.U))
        {
            weapons_Button.onClick.Invoke();
        }
    }
}

