using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class WeaponControllerUI : MonoBehaviour
{
    // how many times will this weapon be attacking per turn?
    // we'll keep a visual track of this information, and tell the player how many turns until the weapon cools down.
    public List<AttackInformation> attackInstances = new List<AttackInformation>();

    public WeaponController controller;
    public ShipController ship;

    UIController parentUI;

    public TextMeshProUGUI textUI;

    public ButtonColorProperties colorProperties;

    public Button button;
    public Image buttonImage;

    public void AttackWithWeapon()
    {
        if (GameManager.Instance.simulationController.SimulationState != SimulationState.Simulating)
        {
            //int timeSelected = Mathf.RoundToInt(GameManager.Instance.selectedTime);
            //parentUI.MarkUI(timeSelected);
            ship.QueueWeaponAttack(Mathf.RoundToInt(GameManager.Instance.selectedTime), controller);
            // parentUI.MarkUI(timeSelected);
            parentUI.UpdateAttackQueueUI(GameManager.Instance.shipSelected.attackOrders);

            SetButtonSelected(true);
        }
    }

    public void AssignWeaponUI(WeaponController weaponController, ShipController origin, UIController uIController)
    {
        controller = weaponController;
        ship = origin;
        parentUI = uIController;
        textUI.text = weaponController.weaponName;
    }

    public void SetButtonSelected(bool selected)
    {
        var bColor = button.colors;

        if (selected)
        {
            buttonImage.color = colorProperties.selectedColor;
        }
        else
        {
            buttonImage.color = colorProperties.unselectedColor;
        }
    }

    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
