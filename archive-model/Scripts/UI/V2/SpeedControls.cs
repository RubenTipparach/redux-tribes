using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class SpeedControls : MonoBehaviour
{

    public Button OneXSpeed;
    public Button TwoXSpeed;
    public Button FourXSpeed;

    public Sprite oneX_Up;
    public Sprite oneX_Down;

    public Sprite twoX_Up;
    public Sprite twoX_Down;

    public Sprite fourX_Up;
    public Sprite fourX_Down;

    public int Speed = 1;

    void Start()
    {

        OneXSpeed.onClick.AddListener(() =>
        {
            SetSpeedButtonClick(1);
            OneXSpeed.image.sprite = oneX_Down;
        });

        TwoXSpeed.onClick.AddListener(() =>
        {
            SetSpeedButtonClick(2);
            TwoXSpeed.image.sprite = twoX_Down;

        });

        FourXSpeed.onClick.AddListener(() =>
        {
            SetSpeedButtonClick(4);
            FourXSpeed.image.sprite = fourX_Down;
        });

        SetSpeedButtonClick(1);
        OneXSpeed.image.sprite = oneX_Down;
    }

    private void SetSpeedButtonClick(float speed)
    {

        GameManager.Instance.SetSpeedScale(speed);

        OneXSpeed.image.sprite = oneX_Up;
        TwoXSpeed.image.sprite = twoX_Up;
        FourXSpeed.image.sprite = fourX_Up;
    }

    public void CheckControls()
    {
        if (Input.GetKeyDown(KeyCode.Equals))
        {
            Speed = Mathf.Clamp(Speed + 1, 1, 3);
            SetSpeed();
            Debug.Log("change speed +");
        }

        if (Input.GetKeyDown(KeyCode.Minus))
        {
            Speed = Mathf.Clamp(Speed - 1, 1, 3);
            SetSpeed();
            Debug.Log("change speed -");
        }
    }

    private void SetSpeed()
    {
        if (Speed == 1)
        {
            OneXSpeed.onClick.Invoke();
        }

        if (Speed == 2)
        {
            TwoXSpeed.onClick.Invoke();
        }

        if (Speed == 3)
        {
            FourXSpeed.onClick.Invoke();
        }
    }
}